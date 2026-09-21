import fs from 'fs/promises';
import path from 'path';
import { simpleParser } from 'mailparser';
import { rootLogger } from '../core/logger.js';

const logger = rootLogger.forComponent('eml-dataset-client');

/**
 * Loads a labeled `.eml` dataset for offline AI-prompt evaluation. Each bucket
 * (e.g. `ham`, `marketing`, `spam`) is an explicit `{bucket: folderPath}`
 * entry - the bucket name comes from the caller-supplied key, not from the
 * folder's own basename, so a folder can live anywhere. Every `.eml` file in
 * a bucket folder is read and parsed once to synthesize an ImapFlow-envelope-
 * shaped object, so the unmodified `extractAiContent` service can be called
 * exactly as production does (see the `ai-prompt-eval` capability and
 * design.md's "Synthesize an envelope once per file" decision).
 * @param {Record<string, string>} bucketPaths - bucket name -> folder path
 * @returns {Promise<{bucketNames: string[], messages: Array<{bucket: string, filename: string, uid: string, envelope: Object, raw: Buffer}>}>}
 *   `bucketNames` lists every bucket given, even one with zero `.eml` files,
 *   so the report can render an empty bucket's section.
 * @throws {Error} if a given bucket folder does not exist or is not readable
 */
export async function loadEmlDataset(bucketPaths) {
  const bucketNames = Object.keys(bucketPaths);
  const messages = [];

  for (const bucket of bucketNames) {
    const bucketPath = bucketPaths[bucket];
    let files;
    try {
      files = (await fs.readdir(bucketPath, { withFileTypes: true }))
        .filter(entry => entry.isFile() && entry.name.endsWith('.eml'))
        .map(entry => entry.name);
    } catch (err) {
      throw new Error(
        `Bucket folder not readable: ${bucket} (${bucketPath}) (${err.message})`,
        { cause: err }
      );
    }

    for (const filename of files) {
      const raw = await fs.readFile(path.join(bucketPath, filename));
      const parsed = await simpleParser(raw);
      const envelope = {
        from: parsed.from?.value || [],
        to: parsed.to?.value || [],
        subject: parsed.subject || '',
        date: parsed.date,
      };

      messages.push({
        bucket,
        filename,
        uid: `${bucket}/${filename}`,
        envelope,
        raw,
      });
    }

    logger.debug({ bucket, count: files.length }, 'Loaded dataset bucket');
  }

  return { bucketNames, messages };
}
