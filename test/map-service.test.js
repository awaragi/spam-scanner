import {extractSenderAddresses} from '../src/lib/services/map-service.js';

describe('map-service', () => {
  describe('extractSenderAddresses', () => {
    it('should extract senders from message headers', () => {
      const messages = [
        {
          uid: 1,
          headers: {
            'from': 'John Doe <john@example.com>',
            'reply-to': 'jane@example.com'
          }
        },
        {
          uid: 2,
          headers: {
            'from': 'Alice <alice@example.com>'
          }
        }
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
            'from': 'john@example.com'
          }
        },
        {
          uid: 2,
          headers: {
            'from': 'john@example.com'
          }
        }
      ];

      const result = extractSenderAddresses(messages);
      
      // Should deduplicate
      expect(result.filter(email => email === 'john@example.com').length).toBe(1);
    });

    it('should handle messages with no extractable senders', () => {
      const messages = [
        {
          uid: 1,
          headers: {}
        }
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
            'from': 'bounce+token123456@example.com'
          }
        },
        {
          uid: 2,
          headers: {
            'from': 'real-person@example.com'
          }
        }
      ];

      const result = extractSenderAddresses(messages);
      
      // Should only include human-readable address
      expect(result).toContain('real-person@example.com');
      // Bounce address should be filtered
      expect(result).not.toContain('bounce+token123456@example.com');
    });
  });
});
