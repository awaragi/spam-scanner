import { vi } from 'vitest';

const { createCompletionMock } = vi.hoisted(() => ({
  createCompletionMock: vi.fn(),
}));

vi.mock('openai', () => {
  const OpenAIMock = vi.fn(function OpenAIMockConstructor(this: any) {
    this.chat = {
      completions: {
        create: createCompletionMock,
      },
    };
  });
  return {
    default: OpenAIMock,
  };
});

import OpenAI from 'openai';
import { AiGateway, AiContent } from './ai.gateway.js';
import { AiConfig } from '../../config/app-config.js';

function mockReply(content: string | undefined) {
  createCompletionMock.mockResolvedValueOnce({
    choices: [{ message: { content } }],
  });
}

const fixtureAiConfig = (): AiConfig => {
  const configService = {
    get: vi.fn((key: string) => {
      const values: Record<string, unknown> = {
        AI_ENABLED: true,
        AI_BASE_URL: 'https://api.openai.com/v1',
        AI_API_KEY: 'test-key-12345',
        AI_MODEL: 'gpt-4o-mini',
        AI_TIMEOUT_MS: 30000,
        AI_MAX_RETRIES: 3,
        AI_CONCURRENCY: 5,
        AI_MAX_INPUT_TOKENS: 8000,
        AI_MAX_OUTPUT_TOKENS: 500,
        AI_FAILURE_ALERT_THRESHOLD: 5,
      };
      return values[key];
    }),
  };
  return new AiConfig(configService as any);
};

const sampleContent: AiContent = {
  from: 'Alice <alice@example.com>',
  to: 'Bob <bob@example.com>',
  subject: 'Free money now',
  date: '2024-01-01T00:00:00.000Z',
  text: 'Click here to claim your prize!',
};

describe('AiGateway', () => {
  let gateway: AiGateway;
  let aiConfig: AiConfig;

  beforeEach(() => {
    createCompletionMock.mockClear();
    vi.clearAllMocks();
    aiConfig = fixtureAiConfig();
    gateway = new AiGateway(aiConfig);
  });

  test('constructs the OpenAI client from injected config', () => {
    const expectedConfig = {
      apiKey: 'test-key-12345',
      baseURL: 'https://api.openai.com/v1',
      timeout: 30000,
      maxRetries: 3,
    };
    expect(OpenAI).toHaveBeenCalledWith(expectedConfig);
  });

  test('calls chat.completions.create with the expected request shape', async () => {
    mockReply('{"score": 42, "reasoning": "borderline"}');

    await gateway.classifyEmail(sampleContent);

    expect(createCompletionMock).toHaveBeenCalledWith({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: gateway.buildSystemPrompt() },
        { role: 'user', content: gateway.buildUserContent(sampleContent) },
      ],
      max_completion_tokens: 500,
    });
  });

  test('routes the response content through parseAiClassificationOutput', async () => {
    mockReply('```json\n{"score": 77, "reasoning": "phishing link"}\n```');

    const result = await gateway.classifyEmail(sampleContent);

    expect(result).toEqual({ score: 77, reasoning: 'phishing link' });
  });

  test('throws a clear error when the response has no message content', async () => {
    createCompletionMock.mockResolvedValueOnce({ choices: [] });

    await expect(gateway.classifyEmail(sampleContent)).rejects.toThrow(
      'Empty response from AI provider'
    );
  });

  test('throws a clear error when message content is empty', async () => {
    mockReply('   ');

    await expect(gateway.classifyEmail(sampleContent)).rejects.toThrow(
      'Empty response from AI provider'
    );
  });

  test('propagates an SDK error unchanged', async () => {
    const sdkError = new Error('Rate limit exceeded');
    createCompletionMock.mockRejectedValueOnce(sdkError);

    await expect(gateway.classifyEmail(sampleContent)).rejects.toThrow(
      'Rate limit exceeded'
    );
  });

  test('system message is identical across two different emails', async () => {
    mockReply('{"score": 10, "reasoning": "clean"}');
    await gateway.classifyEmail(sampleContent);
    const firstSystemMessage =
      createCompletionMock.mock.calls[0][0].messages[0].content;

    mockReply('{"score": 90, "reasoning": "very spammy"}');
    await gateway.classifyEmail({
      ...sampleContent,
      from: 'Eve <eve@example.com>',
      text: 'totally different body',
    });
    const secondSystemMessage =
      createCompletionMock.mock.calls[1][0].messages[0].content;

    expect(firstSystemMessage).toBe(secondSystemMessage);
  });

  test('system message never contains per-email field values', async () => {
    mockReply('{"score": 10, "reasoning": "clean"}');

    await gateway.classifyEmail(sampleContent);

    const systemMessage =
      createCompletionMock.mock.calls[0][0].messages[0].content;
    expect(systemMessage).not.toContain(sampleContent.from);
    expect(systemMessage).not.toContain(sampleContent.to);
    expect(systemMessage).not.toContain(sampleContent.subject);
    expect(systemMessage).not.toContain(sampleContent.text);
  });

  test('buildUserContent formats email fields correctly', () => {
    const content = {
      from: 'test@example.com',
      to: 'recipient@example.com',
      subject: 'Test Subject',
      date: '2024-01-01T00:00:00Z',
      text: 'Test body text',
    };

    const userContent = gateway.buildUserContent(content);

    expect(userContent).toContain('From: test@example.com');
    expect(userContent).toContain('To: recipient@example.com');
    expect(userContent).toContain('Subject: Test Subject');
    expect(userContent).toContain('Date: 2024-01-01T00:00:00Z');
    expect(userContent).toContain('Body:');
    expect(userContent).toContain('Test body text');
  });

  test('buildSystemPrompt contains core safety-net framing', () => {
    const prompt = gateway.buildSystemPrompt();

    expect(prompt).toContain('secondary spam-detection safety net');
    expect(prompt).toContain('phishing');
    expect(prompt).toContain('JSON object');
    expect(prompt).toContain('"score"');
    expect(prompt).toContain('"reasoning"');
  });
});
