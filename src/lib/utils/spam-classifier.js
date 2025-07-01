/**
 * Utility functions for classifying spam messages
 */

/**
 * Categorizes messages based on spam score
 * @param {Array} messages - Array of messages with spam information
 * @param cleanThreshold
 * @param lowProbableThreshold
 * @param highProbableThreshold
 * @returns {Object} - Object with categorized messages
 */
export function categorizeMessages(messages, cleanThreshold = 30, lowProbableThreshold = 60, highProbableThreshold = 100) {
  const lowSpamMessages = [];
  const highSpamMessages = [];
  const nonSpamMessages = [];
  const spamMessages = [];

  messages.forEach(message => {
    const {score, required, isSpam} = message.spamInfo;
    const scorePercentage = score !== null && required !== null && required !== 0
        ? (score / required) * 100
        : null;

    if (isSpam) {
      spamMessages.push(message);
    } else {
      if (scorePercentage === null) {
        nonSpamMessages.push(message);
      } else if (scorePercentage <= cleanThreshold) {
        nonSpamMessages.push(message);
      } else if (scorePercentage < lowProbableThreshold) {
        lowSpamMessages.push(message);
      } else if (scorePercentage < highProbableThreshold) {
        highSpamMessages.push(message);
      } else {
        // default
        highSpamMessages.push(message);
      }
    }
  });

  return {
    lowSpamMessages,
    highSpamMessages,
    nonSpamMessages,
    spamMessages,
  };
}