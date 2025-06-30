import { categorizeMessages } from '../src/lib/utils/spam-classifier.js';

describe('categorizeMessages', () => {
  test('should categorize messages based on spam score', () => {
    const messages = [
      {
        uid: 1,
        spamInfo: {
          score: -1.0,
          isSpam: false,
          subject: 'Clean message'
        }
      },
      {
        uid: 2,
        spamInfo: {
          score: 1.5,
          isSpam: false,
          subject: 'Low spam score'
        }
      },
      {
        uid: 3,
        spamInfo: {
          score: 3.0,
          isSpam: false,
          subject: 'High spam score'
        }
      },
      {
        uid: 4,
        spamInfo: {
          score: 5.0,
          isSpam: true,
          subject: 'Spam message'
        }
      }
    ];

    const result = categorizeMessages(messages);

    expect(result.nonSpamMessages.length).toBe(1);
    expect(result.nonSpamMessages[0].uid).toBe(1);

    expect(result.lowSpamMessages.length).toBe(1);
    expect(result.lowSpamMessages[0].uid).toBe(2);

    expect(result.highSpamMessages.length).toBe(1);
    expect(result.highSpamMessages[0].uid).toBe(3);

    expect(result.spamMessages.length).toBe(1);
    expect(result.spamMessages[0].uid).toBe(4);
  });

  test('should handle null scores', () => {
    const messages = [
      {
        uid: 1,
        spamInfo: {
          score: null,
          isSpam: false,
          subject: 'No score'
        }
      }
    ];

    const result = categorizeMessages(messages);

    expect(result.nonSpamMessages.length).toBe(1);
    expect(result.nonSpamMessages[0].uid).toBe(1);
    expect(result.lowSpamMessages.length).toBe(0);
    expect(result.highSpamMessages.length).toBe(0);
    expect(result.spamMessages.length).toBe(0);
  });

  test('should use custom thresholds', () => {
    const messages = [
      {
        uid: 1,
        spamInfo: {
          score: 1.0,
          isSpam: false,
          subject: 'Low score'
        }
      },
      {
        uid: 2,
        spamInfo: {
          score: 3.0,
          isSpam: false,
          subject: 'Medium score'
        }
      },
      {
        uid: 3,
        spamInfo: {
          score: 5.0,
          isSpam: false,
          subject: 'High score'
        }
      }
    ];

    // Use custom thresholds: low < 2.0, high >= 4.0
    const result = categorizeMessages(messages, 2.0, 4.0);

    expect(result.nonSpamMessages.length).toBe(1);
    expect(result.nonSpamMessages[0].uid).toBe(1);

    expect(result.lowSpamMessages.length).toBe(1);
    expect(result.lowSpamMessages[0].uid).toBe(2);

    expect(result.highSpamMessages.length).toBe(1);
    expect(result.highSpamMessages[0].uid).toBe(3);
  });

  test('should prioritize isSpam flag over score', () => {
    const messages = [
      {
        uid: 1,
        spamInfo: {
          score: 0.0, // Low score
          isSpam: true, // But marked as spam
          subject: 'Spam despite low score'
        }
      }
    ];

    const result = categorizeMessages(messages);

    expect(result.spamMessages.length).toBe(1);
    expect(result.spamMessages[0].uid).toBe(1);
    expect(result.nonSpamMessages.length).toBe(0);
    expect(result.lowSpamMessages.length).toBe(0);
    expect(result.highSpamMessages.length).toBe(0);
  });
});