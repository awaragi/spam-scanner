import { categorizeMessages } from '../src/lib/utils/spam-classifier.js';

describe('categorizeMessages', () => {
  test('should categorize messages based on spam score percentage', () => {
    const messages = [
      {
        uid: 1,
        spamInfo: {
          score: 10,
          required: 100,
          isSpam: false,
          subject: 'Clean message' // 10% - below clean threshold (30%)
        }
      },
      {
        uid: 2,
        spamInfo: {
          score: 45,
          required: 100,
          isSpam: false,
          subject: 'Low spam score' // 45% - between clean (30%) and low probable (60%)
        }
      },
      {
        uid: 3,
        spamInfo: {
          score: 80,
          required: 100,
          isSpam: false,
          subject: 'High spam score' // 80% - between low probable (60%) and high probable (100%)
        }
      },
      {
        uid: 4,
        spamInfo: {
          score: 50,
          required: 100,
          isSpam: true,
          subject: 'Spam message' // Marked as spam regardless of score
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

  test('should handle null scores and required values', () => {
    const messages = [
      {
        uid: 1,
        spamInfo: {
          score: null,
          required: 100,
          isSpam: false,
          subject: 'No score'
        }
      },
      {
        uid: 2,
        spamInfo: {
          score: 50,
          required: null,
          isSpam: false,
          subject: 'No required value'
        }
      },
      {
        uid: 3,
        spamInfo: {
          score: 50,
          required: 0,
          isSpam: false,
          subject: 'Zero required value'
        }
      }
    ];

    const result = categorizeMessages(messages);

    expect(result.nonSpamMessages.length).toBe(3);
    expect(result.nonSpamMessages.map(m => m.uid)).toEqual([1, 2, 3]);
    expect(result.lowSpamMessages.length).toBe(0);
    expect(result.highSpamMessages.length).toBe(0);
    expect(result.spamMessages.length).toBe(0);
  });

  test('should use custom thresholds', () => {
    const messages = [
      {
        uid: 1,
        spamInfo: {
          score: 10,
          required: 100,
          isSpam: false,
          subject: 'Low score' // 10% - below custom clean threshold (20%)
        }
      },
      {
        uid: 2,
        spamInfo: {
          score: 30,
          required: 100,
          isSpam: false,
          subject: 'Medium score' // 30% - between clean (20%) and low probable (40%)
        }
      },
      {
        uid: 3,
        spamInfo: {
          score: 50,
          required: 100,
          isSpam: false,
          subject: 'High score' // 50% - between low probable (40%) and high probable (80%)
        }
      }
    ];

    // Use custom thresholds: clean < 20%, low < 40%, high < 80%
    const result = categorizeMessages(messages, 20, 40, 80);

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
          score: 5,
          required: 100,
          isSpam: true, // Marked as spam despite low score (5%)
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