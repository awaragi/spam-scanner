import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { parse as parseEnvFile } from 'dotenv';
import { simpleParser } from 'mailparser';
import OpenAI from 'openai';
import {
  buildUserContent,
  extractAiContent,
  formatPromptEvalReport,
  type AiContent,
  type PromptEvalResultEntry,
} from 'shared/ai';
import { parseAiClassificationOutput, mapWithConcurrency } from 'shared/utils';
import type { AiConfig } from '../server/src/config/app-config.ts';

/**
 * Offline AI-prompt evaluation: scores a labeled `.eml` dataset with a
 * caller-supplied system prompt and writes a timestamped report. Runs
 * standalone (no Nest, no IMAP) so a prompt wording change can be tried
 * against real, labeled mail with nothing but `npm run eval-prompt -- ...` -
 * edit a plain text file, re-run, compare reports. The `prompt-engineer`
 * skill (`skills/prompt-engineer/`) automates reading the report and editing
 * the prompt file; this script is the thing it runs.
 *
 * Imports from the `shared` package's own `exports` subpaths (`shared/ai`,
 * `shared/utils`) rather than reaching into its `src/` or `dist/` directly:
 * `shared` is a normal workspace package with pre-built ESM output, so this
 * runs standalone with plain `node` and no build step of its own - only
 * `shared` needs to have been built at least once (`npm run build
 * --workspace=shared`, or via `turbo`, which resolves that dependency
 * automatically).
 *
 * AI request settings (model, base URL, tokens, concurrency) come from the
 * same `AI_*` env vars production reads (see `app-config.schema.ts`), loaded
 * from `--env` (default: the repo-root `.env`) - this evaluates the same
 * account/model production uses, varying only the prompt. `buildUserContent`
 * and `extractAiContent` are the exact functions `AiGateway` uses in
 * production, so the request shape sent to the model here matches production
 * byte-for-byte apart from the system prompt itself.
 */

const BUCKET_DESCRIPTIONS = {
  ham: 'Folder of legitimate-mail .eml files to score',
  marketing:
    'Folder of subscribed-marketing .eml files to score (mail the user is legitimately subscribed to)',
  spam: 'Folder of phishing/spam .eml files to score',
} as const;
type BucketName = keyof typeof BUCKET_DESCRIPTIONS;
const BUCKET_NAMES = Object.keys(BUCKET_DESCRIPTIONS) as BucketName[];

interface DatasetMessage {
  bucket: string;
  filename: string;
  envelope: {
    from: Array<{ address?: string; name?: string }>;
    to: Array<{ address?: string; name?: string }>;
    subject: string;
    date: Date | undefined;
  };
  raw: Buffer;
}

/**
 * The subset of production's `AiConfig` this script actually reads, plus
 * two fields `AiConfig` doesn't have (`escalateTo*Threshold`, informational
 * only here - see their assignment below). `Pick`ing from `AiConfig` itself
 * (type-only import, no `@nestjs/config` pulled in at runtime) means a
 * rename over there is caught here by the type checker instead of only
 * surfacing as a runtime `AI_*` env-var lookup failure.
 */
type EvalAiConfig = Pick<
  AiConfig,
  | 'model'
  | 'baseUrl'
  | 'apiKey'
  | 'timeoutMs'
  | 'maxRetries'
  | 'concurrency'
  | 'maxInputTokens'
  | 'maxOutputTokens'
> & {
  escalateToLowThreshold: number;
  escalateToHighThreshold: number;
};

/**
 * Loads a labeled `.eml` dataset. Each bucket (`ham`/`marketing`/`spam`) is a
 * folder of `.eml` files, parsed once each to synthesize an envelope-shaped
 * object so the unmodified `extractAiContent` can be called exactly as
 * production does.
 */
// Disk-read + MIME-parse concurrency for loading the dataset - unrelated to
// aiConfig.concurrency (that's an AI-request-rate knob, not a local file I/O
// one), so it's its own small fixed constant.
const DATASET_LOAD_CONCURRENCY = 8;

async function loadEmlFile(
  bucket: string,
  bucketPath: string,
  filename: string,
): Promise<DatasetMessage> {
  const raw = await fs.readFile(path.join(bucketPath, filename));
  const parsed = await simpleParser(raw);
  // mailparser types `to` as a single AddressObject OR an array of them
  // (multiple `To:` recipients) - `from` has no array case.
  const toAddresses = Array.isArray(parsed.to)
    ? parsed.to
    : parsed.to
      ? [parsed.to]
      : [];
  return {
    bucket,
    filename,
    envelope: {
      from: parsed.from?.value ?? [],
      to: toAddresses.flatMap((addressObject) => addressObject.value),
      subject: parsed.subject ?? '',
      date: parsed.date,
    },
    raw,
  };
}

async function loadEmlDataset(
  bucketPaths: Partial<Record<BucketName, string>>,
): Promise<{ bucketNames: string[]; messages: DatasetMessage[] }> {
  const bucketNames = Object.keys(bucketPaths);
  const fileRefs: Array<{
    bucket: string;
    bucketPath: string;
    filename: string;
  }> = [];

  for (const bucket of bucketNames) {
    const bucketPath = bucketPaths[bucket as BucketName]!;
    try {
      const files = (await fs.readdir(bucketPath, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && entry.name.endsWith('.eml'))
        .map((entry) => entry.name);
      fileRefs.push(
        ...files.map((filename) => ({ bucket, bucketPath, filename })),
      );
    } catch (err) {
      throw new Error(
        `Bucket folder not readable: ${bucket} (${bucketPath}) (${err instanceof Error ? err.message : String(err)})`,
        { cause: err },
      );
    }
  }

  const messages = await mapWithConcurrency(
    fileRefs,
    DATASET_LOAD_CONCURRENCY,
    ({ bucket, bucketPath, filename }) =>
      loadEmlFile(bucket, bucketPath, filename),
  );

  return { bucketNames, messages };
}

/**
 * Classifies a single dataset message, never throwing - failures are caught
 * and reflected as `error` so one bad message doesn't abort the batch.
 */
async function classifyOne(
  message: DatasetMessage,
  systemPrompt: string,
  aiConfig: EvalAiConfig,
  client: OpenAI,
): Promise<PromptEvalResultEntry> {
  const { bucket, filename } = message;
  try {
    const content: AiContent = await extractAiContent(
      {
        uid: `${bucket}/${filename}`,
        raw: message.raw,
        envelope: message.envelope,
      },
      { maxInputTokens: aiConfig.maxInputTokens },
    );

    const response = await client.chat.completions.create({
      model: aiConfig.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: buildUserContent(content) },
      ],
      max_completion_tokens: aiConfig.maxOutputTokens,
    });

    const replyContent = response?.choices?.[0]?.message?.content?.trim();
    if (!replyContent) {
      throw new Error('Empty response from AI provider');
    }

    const { score, reasoning } = parseAiClassificationOutput(replyContent);
    return { bucket, filename, score, reasoning, error: null };
  } catch (err) {
    return {
      bucket,
      filename,
      score: null,
      reasoning: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function classifyDataset(
  messages: DatasetMessage[],
  systemPrompt: string,
  aiConfig: EvalAiConfig,
  client: OpenAI,
): Promise<PromptEvalResultEntry[]> {
  return mapWithConcurrency(messages, aiConfig.concurrency, (message) =>
    classifyOne(message, systemPrompt, aiConfig, client),
  );
}

function timestampFor(date: Date): string {
  return date.toISOString().replace(/:/g, '-').split('.')[0];
}

async function writeReport(
  reportsDir: string,
  reportText: string,
  generatedAt: Date,
): Promise<string> {
  await fs.mkdir(reportsDir, { recursive: true });
  const filePath = path.join(reportsDir, `${timestampFor(generatedAt)}.txt`);
  await fs.writeFile(filePath, reportText, 'utf-8');
  return filePath;
}

export async function runPromptEval({
  promptPath,
  bucketPaths,
  reportsDir,
  aiConfig,
}: {
  promptPath: string;
  bucketPaths: Partial<Record<BucketName, string>>;
  reportsDir: string;
  aiConfig: EvalAiConfig;
}): Promise<{ reportPath: string; bucketCounts: Record<string, number> }> {
  const systemPrompt = await fs.readFile(promptPath, 'utf-8');
  const { bucketNames, messages } = await loadEmlDataset(bucketPaths);

  const client = new OpenAI({
    apiKey: aiConfig.apiKey || 'not-needed',
    baseURL: aiConfig.baseUrl,
    timeout: aiConfig.timeoutMs,
    maxRetries: aiConfig.maxRetries,
  });

  const results = await classifyDataset(
    messages,
    systemPrompt,
    aiConfig,
    client,
  );

  const generatedAt = new Date();
  const { report: reportText, bucketCounts } = formatPromptEvalReport({
    bucketNames,
    results,
    config: {
      promptPath,
      model: aiConfig.model,
      maxInputTokens: aiConfig.maxInputTokens,
      maxOutputTokens: aiConfig.maxOutputTokens,
      concurrency: aiConfig.concurrency,
      escalateToLowThreshold: aiConfig.escalateToLowThreshold,
      escalateToHighThreshold: aiConfig.escalateToHighThreshold,
    },
    generatedAt,
  });

  const reportPath = await writeReport(reportsDir, reportText, generatedAt);

  return { reportPath, bucketCounts };
}

const isMainModule =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  let parser = yargs(hideBin(process.argv))
    .usage(
      `Usage: $0 --prompt <file> --reports <folder> ${BUCKET_NAMES.map((name) => `[--${name} <folder>]`).join(' ')}`,
    )
    .option('prompt', {
      type: 'string',
      demandOption: true,
      describe: 'Path to a text file containing the system prompt to test',
    })
    .option('reports', {
      type: 'string',
      demandOption: true,
      describe: 'Folder to write the timestamped report file to',
    })
    .option('env', {
      type: 'string',
      describe:
        'Env file to read AI_* settings from (default: the repo-root .env, if present)',
    });
  for (const [name, describe] of Object.entries(BUCKET_DESCRIPTIONS)) {
    parser = parser.option(name, { type: 'string', describe });
  }

  const argv = await parser
    .check((argv) => {
      if (!BUCKET_NAMES.some((name) => argv[name])) {
        throw new Error(
          `At least one of ${BUCKET_NAMES.map((name) => `--${name}`).join(', ')} must be given`,
        );
      }
      return true;
    })
    .strict()
    .help().argv;

  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const envPath = argv.env ?? path.resolve(scriptDir, '../.env');
  let env: Record<string, string | undefined> = {};
  try {
    env = parseEnvFile(await fs.readFile(envPath, 'utf-8'));
  } catch (err) {
    if (argv.env) {
      console.error(`Could not read --env file: ${envPath}`);
      process.exitCode = 1;
      throw err;
    }
    // No --env given and no repo-root .env - fall back to process.env/defaults below.
  }
  const getEnv = (key: string): string | undefined =>
    env[key] ?? process.env[key];

  const model = getEnv('AI_MODEL');
  if (!model) {
    console.error(
      'AI_MODEL is not set (checked --env / repo-root .env / process.env). Set it to the model to evaluate against.',
    );
    process.exitCode = 1;
  } else {
    const aiConfig: EvalAiConfig = {
      model,
      baseUrl: getEnv('AI_BASE_URL') ?? 'https://api.openai.com/v1',
      apiKey: getEnv('AI_API_KEY') ?? '',
      timeoutMs: Number(getEnv('AI_TIMEOUT_MS') ?? 15000),
      maxRetries: Number(getEnv('AI_MAX_RETRIES') ?? 1),
      concurrency: Number(getEnv('AI_CONCURRENCY') ?? 5),
      maxInputTokens: Number(getEnv('AI_MAX_INPUT_TOKENS') ?? 6000),
      maxOutputTokens: Number(getEnv('AI_MAX_OUTPUT_TOKENS') ?? 2000),
      // Informational only (annotates the report against `shared`'s own
      // escalation defaults - `spam-classifier.ts` - not read from env in
      // production since escalation thresholds are per-mailbox settings).
      escalateToLowThreshold: Number(
        getEnv('AI_ESCALATE_TO_LOW_THRESHOLD') ?? 50,
      ),
      escalateToHighThreshold: Number(
        getEnv('AI_ESCALATE_TO_HIGH_THRESHOLD') ?? 80,
      ),
    };

    const bucketPaths = Object.fromEntries(
      BUCKET_NAMES.map((name) => [name, argv[name]]).filter(
        ([, folder]) => folder != null,
      ),
    ) as Partial<Record<BucketName, string>>;

    try {
      const { reportPath, bucketCounts } = await runPromptEval({
        promptPath: argv.prompt,
        bucketPaths,
        reportsDir: argv.reports,
        aiConfig,
      });
      console.log(`Report written: ${reportPath}`);
      console.log(bucketCounts);
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  }
}
