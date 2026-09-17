import { categorizeMessages, applyAiEscalation } from '../src/lib/utils/spam-classifier.js';

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

  test('should put a whitelisted, non-spam message in whitelistedMessages instead of nonSpamMessages', () => {
    const messages = [
      {
        uid: 1,
        spamInfo: {
          score: 5,
          required: 100,
          isSpam: false,
          isWhitelisted: true,
          subject: 'Newsletter from a whitelisted sender'
        }
      }
    ];

    const result = categorizeMessages(messages);

    expect(result.whitelistedMessages.length).toBe(1);
    expect(result.whitelistedMessages[0].uid).toBe(1);
    expect(result.nonSpamMessages).toEqual([]);
  });

  test('should still bucket a whitelisted message by score if it is also flagged isSpam (reject wins)', () => {
    const messages = [
      {
        uid: 1,
        spamInfo: {
          score: 50,
          required: 100,
          isSpam: true,
          isWhitelisted: true,
          subject: 'Whitelisted sender but rspamd rejected anyway'
        }
      }
    ];

    const result = categorizeMessages(messages);

    expect(result.spamMessages.length).toBe(1);
    expect(result.spamMessages[0].uid).toBe(1);
    expect(result.whitelistedMessages).toEqual([]);
  });

  test('should treat isWhitelisted as false when absent (backward compatible)', () => {
    const messages = [
      {
        uid: 1,
        spamInfo: {
          score: 10,
          required: 100,
          isSpam: false,
          subject: 'No isWhitelisted field at all'
        }
      }
    ];

    const result = categorizeMessages(messages);

    expect(result.whitelistedMessages).toEqual([]);
    expect(result.nonSpamMessages.map(m => m.uid)).toEqual([1]);
  });

  test('should partition a mixed batch into whitelisted, nonSpam, lowSpam, highSpam, and spam', () => {
    const messages = [
      {uid: 1, spamInfo: {score: 5, required: 100, isSpam: false, isWhitelisted: true, subject: 'wl'}},
      {uid: 2, spamInfo: {score: 10, required: 100, isSpam: false, isWhitelisted: false, subject: 'clean'}},
      {uid: 3, spamInfo: {score: 45, required: 100, isSpam: false, isWhitelisted: false, subject: 'low'}},
      {uid: 4, spamInfo: {score: 80, required: 100, isSpam: false, isWhitelisted: false, subject: 'high'}},
      {uid: 5, spamInfo: {score: 50, required: 100, isSpam: true, isWhitelisted: false, subject: 'spam'}}
    ];

    const result = categorizeMessages(messages);

    expect(result.whitelistedMessages.map(m => m.uid)).toEqual([1]);
    expect(result.nonSpamMessages.map(m => m.uid)).toEqual([2]);
    expect(result.lowSpamMessages.map(m => m.uid)).toEqual([3]);
    expect(result.highSpamMessages.map(m => m.uid)).toEqual([4]);
    expect(result.spamMessages.map(m => m.uid)).toEqual([5]);
  });
});

describe('applyAiEscalation', () => {
  function withAiScore(uid, score, error = null) {
    return {uid, aiInfo: {score, reasoning: score === null ? null : 'ai reasoning', error}};
  }

  function categorizedOf({nonSpam = [], lowSpam = [], highSpam = [], spam = []}) {
    return {
      nonSpamMessages: nonSpam,
      lowSpamMessages: lowSpam,
      highSpamMessages: highSpam,
      spamMessages: spam,
    };
  }

  test('nonSpam message below both thresholds stays nonSpam', () => {
    const categorized = categorizedOf({});
    const aiResults = {nonSpamMessages: [withAiScore(1, 10)], lowSpamMessages: []};

    const result = applyAiEscalation(categorized, aiResults, {escalateToLowThreshold: 50, escalateToHighThreshold: 80});

    expect(result.nonSpamMessages.map(m => m.uid)).toEqual([1]);
    expect(result.lowSpamMessages).toEqual([]);
    expect(result.highSpamMessages).toEqual([]);
  });

  test('nonSpam message in the low band escalates to lowSpam', () => {
    const categorized = categorizedOf({});
    const aiResults = {nonSpamMessages: [withAiScore(1, 60)], lowSpamMessages: []};

    const result = applyAiEscalation(categorized, aiResults, {escalateToLowThreshold: 50, escalateToHighThreshold: 80});

    expect(result.nonSpamMessages).toEqual([]);
    expect(result.lowSpamMessages.map(m => m.uid)).toEqual([1]);
    expect(result.highSpamMessages).toEqual([]);
  });

  test('nonSpam message in the high band escalates directly to highSpam', () => {
    const categorized = categorizedOf({});
    const aiResults = {nonSpamMessages: [withAiScore(1, 90)], lowSpamMessages: []};

    const result = applyAiEscalation(categorized, aiResults, {escalateToLowThreshold: 50, escalateToHighThreshold: 80});

    expect(result.nonSpamMessages).toEqual([]);
    expect(result.lowSpamMessages).toEqual([]);
    expect(result.highSpamMessages.map(m => m.uid)).toEqual([1]);
  });

  test('lowSpam message below the low threshold stays lowSpam (no de-escalation to nonSpam)', () => {
    const categorized = categorizedOf({});
    const aiResults = {nonSpamMessages: [], lowSpamMessages: [withAiScore(1, 0)]};

    const result = applyAiEscalation(categorized, aiResults, {escalateToLowThreshold: 50, escalateToHighThreshold: 80});

    expect(result.nonSpamMessages).toEqual([]);
    expect(result.lowSpamMessages.map(m => m.uid)).toEqual([1]);
  });

  test('lowSpam message above the high threshold escalates to highSpam', () => {
    const categorized = categorizedOf({});
    const aiResults = {nonSpamMessages: [], lowSpamMessages: [withAiScore(1, 95)]};

    const result = applyAiEscalation(categorized, aiResults, {escalateToLowThreshold: 50, escalateToHighThreshold: 80});

    expect(result.lowSpamMessages).toEqual([]);
    expect(result.highSpamMessages.map(m => m.uid)).toEqual([1]);
  });

  test('failed AI classification (aiInfo.error set, score null) leaves message in its original bucket', () => {
    const categorized = categorizedOf({});
    const aiResults = {
      nonSpamMessages: [withAiScore(1, null, 'timeout')],
      lowSpamMessages: [withAiScore(2, null, 'timeout')],
    };

    const result = applyAiEscalation(categorized, aiResults, {escalateToLowThreshold: 50, escalateToHighThreshold: 80});

    expect(result.nonSpamMessages.map(m => m.uid)).toEqual([1]);
    expect(result.lowSpamMessages.map(m => m.uid)).toEqual([2]);
  });

  test('boundary values are inclusive (score === threshold escalates)', () => {
    const categorized = categorizedOf({});
    const aiResults = {
      nonSpamMessages: [withAiScore(1, 50), withAiScore(2, 80)],
      lowSpamMessages: [],
    };

    const result = applyAiEscalation(categorized, aiResults, {escalateToLowThreshold: 50, escalateToHighThreshold: 80});

    expect(result.lowSpamMessages.map(m => m.uid)).toEqual([1]);
    expect(result.highSpamMessages.map(m => m.uid)).toEqual([2]);
  });

  test('custom thresholds override the defaults', () => {
    const categorized = categorizedOf({});
    const aiResults = {nonSpamMessages: [withAiScore(1, 30)], lowSpamMessages: []};

    const result = applyAiEscalation(categorized, aiResults, {escalateToLowThreshold: 25, escalateToHighThreshold: 60});

    expect(result.lowSpamMessages.map(m => m.uid)).toEqual([1]);
  });

  test('original highSpamMessages and spamMessages pass through unmodified', () => {
    const highSpam = [{uid: 10}];
    const spam = [{uid: 20}];
    const categorized = categorizedOf({highSpam, spam});
    const aiResults = {nonSpamMessages: [], lowSpamMessages: []};

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

    const result = applyAiEscalation(categorized, aiResults, {escalateToLowThreshold: 50, escalateToHighThreshold: 80});

    expect(result.spamMessages).toEqual([]);
    expect(result.highSpamMessages.map(m => m.uid).sort()).toEqual([1, 2]);
  });
});