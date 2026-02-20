import {rootLogger} from '../utils/logger.js';
import {extractSenders} from '../utils/email.js';
import {updateMap} from '../utils/rspamd-maps.js';

const logger = rootLogger.forComponent('map-service');

/**
 * Extract sender addresses from messages
 * Pure function for extracting normalized email addresses
 * @param {Array} messages - Array of message objects with headers
 * @returns {Array<string>} - Array of unique sender email addresses
 */
export function extractSenderAddresses(messages) {
  const senders = [];

  for (const message of messages) {
    const {uid, headers} = message;
    const messageLogger = logger.forMessage(uid);
    const messageSenders = extractSenders(headers);

    if (messageSenders.length > 0) {
      senders.push(...messageSenders);
      messageLogger.debug({senders: messageSenders}, 'Extracted senders');
    } else {
      messageLogger.debug('No extractable senders found');
    }
  }

  // Return unique senders
  return [...new Set(senders)];
}

/**
 * Update a map file with sender addresses
 * @param {string} mapPath - Absolute path to map file
 * @param {Array<string>} senders - Array of sender email addresses
 * @returns {Promise<Object>} - Update result with stats
 */
export async function updateMapFile(mapPath, senders) {
  logger.debug({mapPath, count: senders.length}, 'Updating map file');
  
  const result = await updateMap(mapPath, senders);
  
  logger.debug({mapPath, ...result}, 'Map file updated');
  return result;
}
