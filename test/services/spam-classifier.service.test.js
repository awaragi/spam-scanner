import {
  categorizeMessages,
  applyAiEscalation,
  applyWhitelistAdjustment,
  partitionByWhitelistFlag,
  mergeWhitelistedBack,
} from '../../src/lib/services/spam-classifier.service.js';

describe('categorizeMessages', () => {
  test('should categorize messages based on spam score percentage (clean/low/high)', () => {
    const messages = [
      {
        uid: 1,
        spamInfo: { score: 10, required: 100, subject: 'Clean message' },
      }, // 10% - below clean (30%)
      {
        uid: 2,
        spamInfo: { score: 45, required: 100, subject: 'Low spam score' },
      }, // 45% - between clean (30%) and low (60%)
      {
        uid: 3,
        spamInfo: { score: 80, required: 100, subject: 'High spam score' },
      }, // 80% - between low (60%) and confirmed (200%)
    ];

    const result = categorizeMessages(messages, 30, 60, 200);

    expect(result.nonSpamMessages.map(m => m.uid)).toEqual([1]);
    expect(result.lowSpamMessages.map(m => m.uid)).toEqual([2]);
    expect(result.highSpamMessages.map(m => m.uid)).toEqual([3]);
    expect(result.spamMessages).toEqual([]);
  });

  test('a message at or above the confirmed threshold is confirmed spam', () => {
    const messages = [
      {
        uid: 1,
        spamInfo: { score: 200, required: 100, subject: 'Exactly 200%' },
      },
      {
        uid: 2,
        spamInfo: { score: 300, required: 100, subject: 'Well above 200%' },
      },
    ];

    const result = categorizeMessages(messages, 30, 60, 200);

    expect(result.spamMessages.map(m => m.uid)).toEqual([1, 2]);
    expect(result.highSpamMessages).toEqual([]);
  });

  test('should handle null scores and required values as clean', () => {
    const messages = [
      { uid: 1, spamInfo: { score: null, required: 100, subject: 'No score' } },
      {
        uid: 2,
        spamInfo: { score: 50, required: null, subject: 'No required value' },
      },
      {
        uid: 3,
        spamInfo: { score: 50, required: 0, subject: 'Zero required value' },
      },
    ];

    const result = categorizeMessages(messages, 30, 60, 200);

    expect(result.nonSpamMessages.map(m => m.uid)).toEqual([1, 2, 3]);
    expect(result.lowSpamMessages).toEqual([]);
    expect(result.highSpamMessages).toEqual([]);
    expect(result.spamMessages).toEqual([]);
  });

  test('should use custom thresholds (clean, low, confirmed)', () => {
    const messages = [
      { uid: 1, spamInfo: { score: 10, required: 100, subject: 'Low score' } }, // 10% - below custom clean (20%)
      {
        uid: 2,
        spamInfo: { score: 30, required: 100, subject: 'Medium score' },
      }, // 30% - between clean (20%) and low (40%)
      { uid: 3, spamInfo: { score: 50, required: 100, subject: 'High score' } }, // 50% - between low (40%) and confirmed (80%)
      {
        uid: 4,
        spamInfo: { score: 90, required: 100, subject: 'Confirmed score' },
      }, // 90% - at/above custom confirmed (80%)
    ];

    const result = categorizeMessages(messages, 20, 40, 80);

    expect(result.nonSpamMessages.map(m => m.uid)).toEqual([1]);
    expect(result.lowSpamMessages.map(m => m.uid)).toEqual([2]);
    expect(result.highSpamMessages.map(m => m.uid)).toEqual([3]);
    expect(result.spamMessages.map(m => m.uid)).toEqual([4]);
  });

  test('isWhitelisted has no effect on tier assignment - a low-scoring whitelisted message is just clean', () => {
    const messages = [
      {
        uid: 1,
        spamInfo: {
          score: 5,
          required: 100,
          isWhitelisted: true,
          subject: 'Newsletter from a whitelisted sender',
        },
      },
    ];

    const result = categorizeMessages(messages, 30, 60, 200);

    expect(result.nonSpamMessages.map(m => m.uid)).toEqual([1]);
  });

  test('a whitelisted message scoring in the high band is classified high, not silently treated as clean', () => {
    const messages = [
      {
        uid: 1,
        spamInfo: {
          score: 90,
          required: 100,
          isWhitelisted: true,
          subject: 'Whitelisted sender, elevated content',
        },
      },
    ];

    const result = categorizeMessages(messages, 30, 60, 200);

    expect(result.highSpamMessages.map(m => m.uid)).toEqual([1]);
    expect(result.nonSpamMessages).toEqual([]);
  });

  test('severe content still confirms a whitelisted sender (content overrides whitelist)', () => {
    const messages = [
      {
        uid: 1,
        spamInfo: {
          score: 250,
          required: 100,
          isWhitelisted: true,
          subject: 'Whitelisted but severe content',
        },
      },
    ];

    const result = categorizeMessages(messages, 30, 60, 200);

    expect(result.spamMessages.map(m => m.uid)).toEqual([1]);
  });

  test('should treat isWhitelisted as false when absent', () => {
    const messages = [
      {
        uid: 1,
        spamInfo: {
          score: 10,
          required: 100,
          subject: 'No isWhitelisted field at all',
        },
      },
    ];

    const result = categorizeMessages(messages, 30, 60, 200);

    expect(result.nonSpamMessages.map(m => m.uid)).toEqual([1]);
  });

  test('should partition a mixed batch into nonSpam, lowSpam, highSpam, and spam purely by score, ignoring isWhitelisted', () => {
    const messages = [
      {
        uid: 1,
        spamInfo: {
          score: 5,
          required: 100,
          isWhitelisted: true,
          subject: 'whitelisted but clean anyway',
        },
      },
      {
        uid: 2,
        spamInfo: {
          score: 10,
          required: 100,
          isWhitelisted: false,
          subject: 'clean',
        },
      },
      {
        uid: 3,
        spamInfo: {
          score: 45,
          required: 100,
          isWhitelisted: false,
          subject: 'low',
        },
      },
      {
        uid: 4,
        spamInfo: {
          score: 80,
          required: 100,
          isWhitelisted: true,
          subject: 'whitelisted but still high',
        },
      },
      {
        uid: 5,
        spamInfo: {
          score: 250,
          required: 100,
          isWhitelisted: false,
          subject: 'confirmed',
        },
      },
    ];

    const result = categorizeMessages(messages, 30, 60, 200);

    expect(result.nonSpamMessages.map(m => m.uid)).toEqual([1, 2]);
    expect(result.lowSpamMessages.map(m => m.uid)).toEqual([3]);
    expect(result.highSpamMessages.map(m => m.uid)).toEqual([4]);
    expect(result.spamMessages.map(m => m.uid)).toEqual([5]);
  });
});

describe('applyAiEscalation', () => {
  function withAiScore(uid, score, error = null) {
    return {
      uid,
      aiInfo: {
        score,
        reasoning: score === null ? null : 'ai reasoning',
        error,
      },
    };
  }

  function categorizedOf({
    nonSpam = [],
    lowSpam = [],
    highSpam = [],
    spam = [],
  }) {
    return {
      nonSpamMessages: nonSpam,
      lowSpamMessages: lowSpam,
      highSpamMessages: highSpam,
      spamMessages: spam,
    };
  }

  test('nonSpam message below both thresholds stays nonSpam', () => {
    const categorized = categorizedOf({});
    const aiResults = {
      nonSpamMessages: [withAiScore(1, 10)],
      lowSpamMessages: [],
    };

    const result = applyAiEscalation(categorized, aiResults, {
      escalateToLowThreshold: 50,
      escalateToHighThreshold: 80,
    });

    expect(result.nonSpamMessages.map(m => m.uid)).toEqual([1]);
    expect(result.lowSpamMessages).toEqual([]);
    expect(result.highSpamMessages).toEqual([]);
  });

  test('nonSpam message in the low band escalates to lowSpam', () => {
    const categorized = categorizedOf({});
    const aiResults = {
      nonSpamMessages: [withAiScore(1, 60)],
      lowSpamMessages: [],
    };

    const result = applyAiEscalation(categorized, aiResults, {
      escalateToLowThreshold: 50,
      escalateToHighThreshold: 80,
    });

    expect(result.nonSpamMessages).toEqual([]);
    expect(result.lowSpamMessages.map(m => m.uid)).toEqual([1]);
    expect(result.highSpamMessages).toEqual([]);
  });

  test('nonSpam message in the high band escalates directly to highSpam', () => {
    const categorized = categorizedOf({});
    const aiResults = {
      nonSpamMessages: [withAiScore(1, 90)],
      lowSpamMessages: [],
    };

    const result = applyAiEscalation(categorized, aiResults, {
      escalateToLowThreshold: 50,
      escalateToHighThreshold: 80,
    });

    expect(result.nonSpamMessages).toEqual([]);
    expect(result.lowSpamMessages).toEqual([]);
    expect(result.highSpamMessages.map(m => m.uid)).toEqual([1]);
  });

  test('lowSpam message below the low threshold stays lowSpam (no de-escalation to nonSpam)', () => {
    const categorized = categorizedOf({});
    const aiResults = {
      nonSpamMessages: [],
      lowSpamMessages: [withAiScore(1, 0)],
    };

    const result = applyAiEscalation(categorized, aiResults, {
      escalateToLowThreshold: 50,
      escalateToHighThreshold: 80,
    });

    expect(result.nonSpamMessages).toEqual([]);
    expect(result.lowSpamMessages.map(m => m.uid)).toEqual([1]);
  });

  test('lowSpam message above the high threshold escalates to highSpam', () => {
    const categorized = categorizedOf({});
    const aiResults = {
      nonSpamMessages: [],
      lowSpamMessages: [withAiScore(1, 95)],
    };

    const result = applyAiEscalation(categorized, aiResults, {
      escalateToLowThreshold: 50,
      escalateToHighThreshold: 80,
    });

    expect(result.lowSpamMessages).toEqual([]);
    expect(result.highSpamMessages.map(m => m.uid)).toEqual([1]);
  });

  test('failed AI classification (aiInfo.error set, score null) leaves message in its original bucket', () => {
    const categorized = categorizedOf({});
    const aiResults = {
      nonSpamMessages: [withAiScore(1, null, 'timeout')],
      lowSpamMessages: [withAiScore(2, null, 'timeout')],
    };

    const result = applyAiEscalation(categorized, aiResults, {
      escalateToLowThreshold: 50,
      escalateToHighThreshold: 80,
    });

    expect(result.nonSpamMessages.map(m => m.uid)).toEqual([1]);
    expect(result.lowSpamMessages.map(m => m.uid)).toEqual([2]);
  });

  test('boundary values are inclusive (score === threshold escalates)', () => {
    const categorized = categorizedOf({});
    const aiResults = {
      nonSpamMessages: [withAiScore(1, 50), withAiScore(2, 80)],
      lowSpamMessages: [],
    };

    const result = applyAiEscalation(categorized, aiResults, {
      escalateToLowThreshold: 50,
      escalateToHighThreshold: 80,
    });

    expect(result.lowSpamMessages.map(m => m.uid)).toEqual([1]);
    expect(result.highSpamMessages.map(m => m.uid)).toEqual([2]);
  });

  test('custom thresholds override the defaults', () => {
    const categorized = categorizedOf({});
    const aiResults = {
      nonSpamMessages: [withAiScore(1, 30)],
      lowSpamMessages: [],
    };

    const result = applyAiEscalation(categorized, aiResults, {
      escalateToLowThreshold: 25,
      escalateToHighThreshold: 60,
    });

    expect(result.lowSpamMessages.map(m => m.uid)).toEqual([1]);
  });

  test('original highSpamMessages and spamMessages pass through unmodified', () => {
    const highSpam = [{ uid: 10 }];
    const spam = [{ uid: 20 }];
    const categorized = categorizedOf({ highSpam, spam });
    const aiResults = { nonSpamMessages: [], lowSpamMessages: [] };

    const result = applyAiEscalation(categorized, aiResults);

    expect(result.highSpamMessages).toEqual(highSpam);
    expect(result.spamMessages).toEqual(spam);
  });

  test('regression: no AI score, however high, ever produces a spamMessages result', () => {
    const categorized = categorizedOf({});
    const aiResults = {
      nonSpamMessages: [withAiScore(1, 100)],
      lowSpamMessages: [withAiScore(2, 100)],
    };

    const result = applyAiEscalation(categorized, aiResults, {
      escalateToLowThreshold: 50,
      escalateToHighThreshold: 80,
    });

    expect(result.spamMessages).toEqual([]);
    expect(result.highSpamMessages.map(m => m.uid).sort()).toEqual([1, 2]);
  });
});

describe('applyWhitelistAdjustment', () => {
  test('subtracts 20 when whitelisted', () => {
    expect(applyWhitelistAdjustment(30, true)).toBe(10);
  });

  test('leaves the score unchanged when not whitelisted', () => {
    expect(applyWhitelistAdjustment(30, false)).toBe(30);
  });
});

describe('partitionByWhitelistFlag', () => {
  test('splits messages by spamInfo.isWhitelisted', () => {
    const messages = [
      { uid: 1, spamInfo: { isWhitelisted: true } },
      { uid: 2, spamInfo: { isWhitelisted: false } },
      { uid: 3, spamInfo: { isWhitelisted: true } },
    ];

    const { whitelisted, rest } = partitionByWhitelistFlag(messages);

    expect(whitelisted.map(m => m.uid)).toEqual([1, 3]);
    expect(rest.map(m => m.uid)).toEqual([2]);
  });

  test('treats a missing spamInfo as not whitelisted', () => {
    const { whitelisted, rest } = partitionByWhitelistFlag([{ uid: 1 }]);
    expect(whitelisted).toEqual([]);
    expect(rest.map(m => m.uid)).toEqual([1]);
  });
});

describe('mergeWhitelistedBack', () => {
  test('appends whitelisted messages back onto nonSpam/lowSpam, leaving other fields untouched', () => {
    const categorized = {
      nonSpamMessages: [{ uid: 1 }],
      lowSpamMessages: [{ uid: 2 }],
      highSpamMessages: [{ uid: 3 }],
      spamMessages: [{ uid: 4 }],
    };

    const result = mergeWhitelistedBack(
      categorized,
      [{ uid: 10 }],
      [{ uid: 20 }]
    );

    expect(result.nonSpamMessages.map(m => m.uid)).toEqual([1, 10]);
    expect(result.lowSpamMessages.map(m => m.uid)).toEqual([2, 20]);
    expect(result.highSpamMessages).toBe(categorized.highSpamMessages);
    expect(result.spamMessages).toBe(categorized.spamMessages);
  });
});
