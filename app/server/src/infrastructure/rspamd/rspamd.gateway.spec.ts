import { Test, TestingModule } from '@nestjs/testing';
import { vi } from 'vitest';
import { RspamdGateway } from './rspamd.gateway.js';
import { RspamdConfig } from '../../config/app-config.js';

describe('RspamdGateway', () => {
  let gateway: RspamdGateway;
  let module: TestingModule;
  let mockConfig: RspamdConfig;

  beforeEach(async () => {
    // Create a fixture RspamdConfig
    mockConfig = {
      url: 'http://localhost:11333',
      password: 'test-password',
      timeoutMs: 5000,
      envelopeTrustedHops: 0,
    } as RspamdConfig;

    module = await Test.createTestingModule({
      providers: [
        RspamdGateway,
        {
          provide: RspamdConfig,
          useValue: mockConfig,
        },
      ],
    }).compile();

    gateway = module.get<RspamdGateway>(RspamdGateway);

    // Mock fetch globally
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('checkEmail', () => {
    test('should send email to /checkv2 endpoint and return result', async () => {
      const emailContent = 'From: test@example.com\nSubject: Test\n\nBody';
      const mockResponse = {
        action: 'add header',
        score: 8.5,
        required_score: 10.0,
        symbols: {
          TEST_SYMBOL: { score: 2.5, description: 'Test description' },
        },
        messages: [],
        'message-id': '123456',
        subject: 'Test',
      };

      vi.mocked(global.fetch, { partial: true }).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await gateway.checkEmail(emailContent);

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/checkv2'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'text/plain',
            'Password': 'test-password',
          }),
          body: emailContent,
        })
      );
      expect(result).toEqual(mockResponse);
    });

    test('should pass an abort signal so a stalled request times out', async () => {
      const emailContent = 'From: test@example.com\nSubject: Test\n\nBody';
      vi.mocked(global.fetch, { partial: true }).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ action: 'no action', score: 0 }),
      } as Response);

      await gateway.checkEmail(emailContent);

      const options = vi.mocked(global.fetch).mock.calls[0][1];
      expect(options?.signal).toBeInstanceOf(AbortSignal);
    });

    test('should include password header when configured', async () => {
      const emailContent = 'From: test@example.com\nSubject: Test\n\nBody';
      const mockResponse = { action: 'no action', score: 0 };

      vi.mocked(global.fetch, { partial: true }).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await gateway.checkEmail(emailContent);

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/checkv2'),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Password': 'test-password',
          }),
        })
      );
    });

    test('should throw error on non-ok response', async () => {
      const emailContent = 'From: test@example.com\nSubject: Test\n\nBody';

      vi.mocked(global.fetch, { partial: true }).mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'Bad Request',
      } as Response);

      await expect(gateway.checkEmail(emailContent)).rejects.toThrow(
        'Rspamd check failed with status 400'
      );
    });

    test('should attach the HTTP status to the thrown error on non-ok response', async () => {
      const emailContent = 'From: test@example.com\nSubject: Test\n\nBody';

      vi.mocked(global.fetch, { partial: true }).mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'Bad Request',
      } as Response);

      await expect(gateway.checkEmail(emailContent)).rejects.toMatchObject({
        status: 400,
      });
    });

    test('should throw error when email content is empty', async () => {
      await expect(gateway.checkEmail('')).rejects.toThrow(
        'Email content is required'
      );
    });

    test('should throw error when email content is null', async () => {
      await expect(gateway.checkEmail(null)).rejects.toThrow(
        'Email content is required'
      );
    });

    test('should throw error on network failure', async () => {
      const emailContent = 'From: test@example.com\nSubject: Test\n\nBody';

      vi.mocked(global.fetch).mockRejectedValueOnce(
        new Error('Network error')
      );

      await expect(gateway.checkEmail(emailContent)).rejects.toThrow(
        'Network error'
      );
    });

    test('should send envelope data as IP/Helo/From/Rcpt headers when provided', async () => {
      const emailContent = 'From: test@example.com\nSubject: Test\n\nBody';
      vi.mocked(global.fetch, { partial: true }).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ action: 'no action', score: 0 }),
      } as Response);

      await gateway.checkEmail(emailContent, {
        ip: '203.0.113.5',
        helo: 'mail.example.com',
        from: 'sender@example.com',
        rcpt: 'owner@example.com',
      });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/checkv2'),
        expect.objectContaining({
          headers: {
            'Content-Type': 'text/plain',
            'Password': 'test-password',
            IP: '203.0.113.5',
            Helo: 'mail.example.com',
            From: 'sender@example.com',
            Rcpt: 'owner@example.com',
          },
        })
      );
    });

    test('should omit envelope headers that are absent, null, or not provided at all', async () => {
      const emailContent = 'From: test@example.com\nSubject: Test\n\nBody';
      vi.mocked(global.fetch, { partial: true }).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ action: 'no action', score: 0 }),
      } as Response);

      await gateway.checkEmail(emailContent, { ip: null, helo: 'mail.example.com' });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/checkv2'),
        expect.objectContaining({
          headers: {
            'Content-Type': 'text/plain',
            'Password': 'test-password',
            Helo: 'mail.example.com',
          },
        })
      );
    });
  });

  describe('learnHam', () => {
    test('should send email to /learnham endpoint and return result', async () => {
      const emailContent = 'From: test@example.com\nSubject: Test\n\nBody';
      const mockResponse = { success: true, message: 'Learned successfully' };

      vi.mocked(global.fetch, { partial: true }).mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify(mockResponse),
      } as Response);

      const result = await gateway.learnHam(emailContent);

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/learnham'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'text/plain',
            'Password': 'test-password',
          }),
          body: emailContent,
        })
      );
      expect(result).toEqual(mockResponse);
    });

    test('should ignore already learned ham responses', async () => {
      const emailContent = 'From: test@example.com\nSubject: Test\n\nBody';
      const mockResponse = {
        success: false,
        error: '<msgid@example.com> has been already learned as ham, ignore it',
      };

      vi.mocked(global.fetch, { partial: true }).mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify(mockResponse),
      } as Response);

      const result = await gateway.learnHam(emailContent);

      expect(result).toEqual({
        success: true,
        message: mockResponse.error,
        alreadyLearned: true,
      });
    });

    test('should throw error on non-ok response', async () => {
      const emailContent = 'From: test@example.com\nSubject: Test\n\nBody';

      vi.mocked(global.fetch, { partial: true }).mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      } as Response);

      await expect(gateway.learnHam(emailContent)).rejects.toThrow(
        'Rspamd learn ham failed with status 401'
      );
    });

    test('should throw error when email content is empty', async () => {
      await expect(gateway.learnHam('')).rejects.toThrow(
        'Email content is required'
      );
    });

    test('should throw error on network failure', async () => {
      const emailContent = 'From: test@example.com\nSubject: Test\n\nBody';

      vi.mocked(global.fetch).mockRejectedValueOnce(
        new Error('Connection refused')
      );

      await expect(gateway.learnHam(emailContent)).rejects.toThrow(
        'Connection refused'
      );
    });

    test('should handle empty response body', async () => {
      const emailContent = 'From: test@example.com\nSubject: Test\n\nBody';

      vi.mocked(global.fetch, { partial: true }).mockResolvedValueOnce({
        ok: true,
        text: async () => '',
      } as Response);

      const result = await gateway.learnHam(emailContent);

      expect(result).toEqual({
        success: true,
        message: '',
      });
    });
  });

  describe('learnSpam', () => {
    test('should send email to /learnspam endpoint and return result', async () => {
      const emailContent = 'From: test@example.com\nSubject: Test\n\nBody';
      const mockResponse = { success: true, message: 'Learned successfully' };

      vi.mocked(global.fetch, { partial: true }).mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify(mockResponse),
      } as Response);

      const result = await gateway.learnSpam(emailContent);

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/learnspam'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'text/plain',
            'Password': 'test-password',
          }),
          body: emailContent,
        })
      );
      expect(result).toEqual(mockResponse);
    });

    test('should ignore already learned spam responses', async () => {
      const emailContent = 'From: test@example.com\nSubject: Test\n\nBody';
      const mockResponse = {
        success: false,
        error: '<msgid@example.com> has been already learned as spam, ignore it',
      };

      vi.mocked(global.fetch, { partial: true }).mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify(mockResponse),
      } as Response);

      const result = await gateway.learnSpam(emailContent);

      expect(result).toEqual({
        success: true,
        message: mockResponse.error,
        alreadyLearned: true,
      });
    });

    test('should throw error on non-ok response', async () => {
      const emailContent = 'From: test@example.com\nSubject: Test\n\nBody';

      vi.mocked(global.fetch, { partial: true }).mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: async () => 'Service Unavailable',
      } as Response);

      await expect(gateway.learnSpam(emailContent)).rejects.toThrow(
        'Rspamd learn spam failed with status 503'
      );
    });

    test('should throw error when email content is empty', async () => {
      await expect(gateway.learnSpam('')).rejects.toThrow(
        'Email content is required'
      );
    });

    test('should throw error on network failure', async () => {
      const emailContent = 'From: test@example.com\nSubject: Test\n\nBody';

      vi.mocked(global.fetch).mockRejectedValueOnce(new Error('Timeout'));

      await expect(gateway.learnSpam(emailContent)).rejects.toThrow('Timeout');
    });

    test('should handle empty response body', async () => {
      const emailContent = 'From: test@example.com\nSubject: Test\n\nBody';

      vi.mocked(global.fetch, { partial: true }).mockResolvedValueOnce({
        ok: true,
        text: async () => '',
      } as Response);

      const result = await gateway.learnSpam(emailContent);

      expect(result).toEqual({
        success: true,
        message: '',
      });
    });
  });
});
