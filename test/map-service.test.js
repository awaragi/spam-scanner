const { readMapState, writeMapState } = vi.hoisted(() => ({
  readMapState: vi.fn(),
  writeMapState: vi.fn().mockResolvedValue(true),
}));

vi.mock('../src/lib/state-manager.js', () => ({
  readMapState,
  writeMapState,
}));

vi.mock('../src/lib/utils/logger.js', () => ({
  rootLogger: {
    forComponent: () => ({
      forMessage: () => ({ debug: vi.fn() }),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

import {
  extractSenderAddresses,
  updateListState,
} from '../src/lib/services/map-service.js';

describe('map-service', () => {
  describe('extractSenderAddresses', () => {
    it('should extract senders from message headers', () => {
      const messages = [
        {
          uid: 1,
          headers: {
            from: 'John Doe <john@example.com>',
            'reply-to': 'jane@example.com',
          },
        },
        {
          uid: 2,
          headers: {
            from: 'Alice <alice@example.com>',
          },
        },
      ];

      const result = extractSenderAddresses(messages);

      expect(result).toBeInstanceOf(Array);
      expect(result.length).toBeGreaterThan(0);
      expect(result).toContain('john@example.com');
      expect(result).toContain('alice@example.com');
    });

    it('should return unique senders', () => {
      const messages = [
        {
          uid: 1,
          headers: {
            from: 'john@example.com',
          },
        },
        {
          uid: 2,
          headers: {
            from: 'john@example.com',
          },
        },
      ];

      const result = extractSenderAddresses(messages);

      // Should deduplicate
      expect(result.filter(email => email === 'john@example.com').length).toBe(
        1
      );
    });

    it('should handle messages with no extractable senders', () => {
      const messages = [
        {
          uid: 1,
          headers: {},
        },
      ];

      const result = extractSenderAddresses(messages);

      expect(result).toBeInstanceOf(Array);
      expect(result.length).toBe(0);
    });

    it('should handle empty message array', () => {
      const result = extractSenderAddresses([]);

      expect(result).toBeInstanceOf(Array);
      expect(result.length).toBe(0);
    });

    it('should filter non-human-readable addresses', () => {
      const messages = [
        {
          uid: 1,
          headers: {
            from: 'bounce+token123456@example.com',
          },
        },
        {
          uid: 2,
          headers: {
            from: 'real-person@example.com',
          },
        },
      ];

      const result = extractSenderAddresses(messages);

      // Should only include human-readable address
      expect(result).toContain('real-person@example.com');
      // Bounce address should be filtered
      expect(result).not.toContain('bounce+token123456@example.com');
    });
  });

  describe('updateListState', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      writeMapState.mockResolvedValue(true);
    });

    it('append mode merges with existing entries', async () => {
      readMapState.mockResolvedValue(['a@b.com']);

      const result = await updateListState(
        {},
        'rspamd-whitelist-map',
        ['C@D.com', 'a@b.com'],
        'append'
      );

      expect(writeMapState).toHaveBeenCalledWith(
        {},
        'rspamd-whitelist-map',
        JSON.stringify(['a@b.com', 'c@d.com'], null, 2)
      );
      expect(result.added).toEqual(['c@d.com']);
      expect(result.skipped).toEqual(['a@b.com']);
      expect(result.total).toBe(2);
    });

    it('override mode replaces existing entries entirely', async () => {
      readMapState.mockResolvedValue(['old@example.com']);

      const result = await updateListState(
        {},
        'rspamd-blacklist-map',
        ['new@example.com'],
        'override'
      );

      expect(writeMapState).toHaveBeenCalledWith(
        {},
        'rspamd-blacklist-map',
        JSON.stringify(['new@example.com'], null, 2)
      );
      expect(result.removed).toEqual(['old@example.com']);
      expect(result.total).toBe(1);
    });

    it('append mode is idempotent when run twice with the same input', async () => {
      readMapState.mockResolvedValueOnce([]);
      await updateListState({}, 'rspamd-whitelist-map', ['a@b.com'], 'append');
      const firstWrite = JSON.parse(writeMapState.mock.calls[0][2]);

      readMapState.mockResolvedValueOnce(firstWrite);
      await updateListState({}, 'rspamd-whitelist-map', ['a@b.com'], 'append');
      const secondWrite = JSON.parse(writeMapState.mock.calls[1][2]);

      expect(secondWrite).toEqual(firstWrite);
    });

    it('defaults to append mode when mode is omitted', async () => {
      readMapState.mockResolvedValue(['a@b.com']);

      await updateListState({}, 'rspamd-whitelist-map', ['b@c.com']);

      expect(writeMapState).toHaveBeenCalledWith(
        {},
        'rspamd-whitelist-map',
        JSON.stringify(['a@b.com', 'b@c.com'], null, 2)
      );
    });
  });
});
