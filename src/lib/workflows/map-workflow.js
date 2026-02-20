import {rootLogger} from '../utils/logger.js';
import {config} from '../utils/config.js';
import {writeMapState} from '../state-manager.js';
import {open, count, fetchAllMessages, moveMessages} from '../clients/imap-client.js';
import {extractSenderAddresses, updateMapFile} from '../services/map-service.js';
import path from 'path';
import fs from 'fs/promises';

const logger = rootLogger.forComponent('map-workflow');

/**
 * Generic map training workflow handler
 * @param {Object} imap - ImapFlow client
 * @param {string} folder - Training folder path
 * @param {string} mapPath - Path to map file
 * @param {string} mapStateKey - State key for map backup
 * @param {string} destFolder - Destination folder after processing
 * @param {string} type - Map type ('whitelist' or 'blacklist')
 * @returns {Promise<void>}
 */
async function runMapTraining(imap, folder, mapPath, mapStateKey, destFolder, type) {
  // Resolve map path relative to repo root if it's not absolute
  const resolvedMapPath = path.isAbsolute(mapPath)
    ? mapPath
    : path.resolve(process.cwd(), mapPath);

  try {
    const box = await open(imap, folder);
    const messageCount = count(box);

    if (messageCount === 0) {
      logger.debug({folder, type}, 'No messages in training folder');
      return;
    }

    const messages = await fetchAllMessages(imap);
    const senders = extractSenderAddresses(messages);

    if (senders.length === 0) {
      logger.debug({folder, type}, 'No extractable senders found in training folder');
      return;
    }

    // Update map file with senders
    const result = await updateMapFile(resolvedMapPath, senders);
    logger.info({folder, type, ...result}, `${type} map updated`);

    // Backup map state
    let mapContent = null;
    try {
      mapContent = await fs.readFile(resolvedMapPath, 'utf-8');
    } catch (err) {
      if (err.code === 'ENOENT') {
        logger.debug({mapPath: resolvedMapPath, type}, 'Map file not found for state backup');
      } else {
        throw err;
      }
    }

    if (mapContent !== null) {
      await writeMapState(imap, mapStateKey, mapContent);
      logger.debug({folder, type, mapStateKey}, 'Map state backup updated');
    }

    // Move processed messages to destination folder
    await moveMessages(imap, messages, destFolder);
    logger.debug({folder, type, destFolder, total: messages.length}, 'Training messages moved');
  } catch (error) {
    logger.error({folder, type, error: error.message}, `Error in ${type} workflow`);
    throw error;
  }
}

/**
 * Run whitelist training workflow
 * Orchestrates extracting senders and updating whitelist map
 * @param {Object} imap - ImapFlow client
 * @returns {Promise<void>}
 */
export async function runWhitelist(imap) {
  await runMapTraining(
    imap,
    config.FOLDER_TRAIN_WHITELIST,
    config.RSPAMD_WHITELIST_MAP_PATH,
    config.STATE_KEY_WHITELIST_MAP,
    config.FOLDER_INBOX,
    'whitelist'
  );
}

/**
 * Run blacklist training workflow
 * Orchestrates extracting senders and updating blacklist map
 * @param {Object} imap - ImapFlow client
 * @returns {Promise<void>}
 */
export async function runBlacklist(imap) {
  await runMapTraining(
    imap,
    config.FOLDER_TRAIN_BLACKLIST,
    config.RSPAMD_BLACKLIST_MAP_PATH,
    config.STATE_KEY_BLACKLIST_MAP,
    config.FOLDER_SPAM,
    'blacklist'
  );
}
