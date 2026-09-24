import { vi } from 'vitest';

const { createCompletionMock } = vi.hoisted(() => ({
  createCompletionMock: vi.fn(),
}));

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: { completions: { create: createCompletionMock } },
  })),
}));

import OpenAI from 'openai';
import { config } from '../../../src/lib/core/config.ts';
import {
  classifyEmail,
  buildSystemPrompt,
  buildUserContent,
} from '../../../src/lib/clients/ai.client.ts';

function mockReply(content) {
  createCompletionMock.mockResolvedValueOnce({
    choices: [{ message: { content } }],
  });
}

const sampleContent = {
  from: 'Alice <alice@example.com>',
  to: 'Bob <bob@example.com>',
  subject: 'Free money now',
  date: '2024-01-01T00:00:00.000Z',
  text: 'Click here to claim your prize!',
};

describe('ai-client', () => {
  beforeEach(() => {
    createCompletionMock.mockClear();
  });

  test('constructs the OpenAI client from config', () => {
    expect(OpenAI).toHaveBeenCalledWith({
      apiKey: config.AI_API_KEY || 'not-needed',
      baseURL: config.AI_BASE_URL,
      timeout: config.AI_TIMEOUT_MS,
      maxRetries: config.AI_MAX_RETRIES,
    });
  });

  test('calls chat.completions.create with the expected request shape', async () => {
    mockReply('{"score": 42, "reasoning": "borderline"}');

    await classifyEmail(sampleContent);

    expect(createCompletionMock).toHaveBeenCalledWith({
      model: config.AI_MODEL,
      messages: [
        { role: 'system', content: buildSystemPrompt() },
        { role: 'user', content: buildUserContent(sampleContent) },
      ],
      max_completion_tokens: config.AI_MAX_OUTPUT_TOKENS,
    });
  });

  test('routes the response content through parseAiClassificationOutput', async () => {
    mockReply('```json\n{"score": 77, "reasoning": "phishing link"}\n```');

    const result = await classifyEmail(sampleContent);

    expect(result).toEqual({ score: 77, reasoning: 'phishing link' });
  });

  test('throws a clear error when the response has no message content', async () => {
    createCompletionMock.mockResolvedValueOnce({ choices: [] });

    await expect(classifyEmail(sampleContent)).rejects.toThrow(
      'Empty response from AI provider'
    );
  });

  test('throws a clear error when message content is empty', async () => {
    mockReply('   ');

    await expect(classifyEmail(sampleContent)).rejects.toThrow(
      'Empty response from AI provider'
    );
  });

  test('propagates an SDK error unchanged', async () => {
    const sdkError = new Error('Rate limit exceeded');
    createCompletionMock.mockRejectedValueOnce(sdkError);

    await expect(classifyEmail(sampleContent)).rejects.toThrow(
      'Rate limit exceeded'
    );
  });

  test('system message is identical across two different emails (cache-shape regression)', async () => {
    mockReply('{"score": 10, "reasoning": "clean"}');
    await classifyEmail(sampleContent);
    const firstSystemMessage =
      createCompletionMock.mock.calls[0][0].messages[0].content;

    mockReply('{"score": 90, "reasoning": "very spammy"}');
    await classifyEmail({
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

    await classifyEmail(sampleContent);

    const systemMessage =
      createCompletionMock.mock.calls[0][0].messages[0].content;
    expect(systemMessage).not.toContain(sampleContent.from);
    expect(systemMessage).not.toContain(sampleContent.to);
    expect(systemMessage).not.toContain(sampleContent.subject);
    expect(systemMessage).not.toContain(sampleContent.text);
  });
});
