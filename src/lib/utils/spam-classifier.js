/**
 * Utility functions for classifying spam messages
 */

/**
 * Categorizes messages based on spam score
 * @param {Array} messages - Array of messages with spam information
 * @param {number} [lowThreshold=0.0] - Threshold for low spam score
 * @param {number} [highThreshold=2.5] - Threshold for high spam score
 * @returns {Object} - Object with categorized messages
 */
export function categorizeMessages(messages, lowThreshold = 0.0, highThreshold = 2.5) {
  const lowSpamMessages = [];
  const highSpamMessages = [];
  const nonSpamMessages = [];
  const spamMessages = [];

  messages.forEach(message => {
    if (message.spamInfo.isSpam) {
      spamMessages.push(message);
    } else if (message.spamInfo.score === null || message.spamInfo.score < lowThreshold) {
      nonSpamMessages.push(message);
    } else if (message.spamInfo.score < highThreshold) {
      lowSpamMessages.push(message);
    } else {
      // default
      highSpamMessages.push(message);
    }
  });

  return {
    lowSpamMessages,
    highSpamMessages,
    nonSpamMessages,
    spamMessages,
  };
}