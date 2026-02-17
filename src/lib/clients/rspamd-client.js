import {rootLogger} from '../utils/logger.js';
import {config} from '../utils/config.js';

const logger = rootLogger.forComponent('rspamd');

const RSPAMD_URL = config.RSPAMD_URL;
const RSPAMD_PASSWORD = config.RSPAMD_PASSWORD;

/**
 * Builds headers for Rspamd HTTP requests
 * @returns {Object} - Headers object with optional password
 */
function buildHeaders() {
  const headers = {
    'Content-Type': 'text/plain'
  };
  
  if (RSPAMD_PASSWORD) {
    headers['Password'] = RSPAMD_PASSWORD;
  }
  
  return headers;
}

function isAlreadyLearned(result) {
  const error = typeof result?.error === 'string' ? result.error.toLowerCase() : '';
  return error.includes('already learned');
}

async function parseRspamdJson(response) {
  const text = await response.text();
  if (!text) {
    return {success: true, message: ''};
  }

  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`Rspamd response parse failed: ${err.message}`);
  }
}

/**
 * Checks email for spam using Rspamd /checkv2 endpoint
 * @param {string} emailContent - Raw email content including headers
 * @returns {Promise<Object>} - Parsed JSON response from Rspamd
 * @throws {Error} - If the request fails or Rspamd returns an error
 */
export async function checkEmail(emailContent) {
  if (!emailContent) {
    throw new Error('Email content is required');
  }

  try {
    const response = await fetch(`${RSPAMD_URL}/checkv2`, {
      method: 'POST',
      headers: buildHeaders(),
      body: emailContent
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Rspamd check failed with status ${response.status}: ${error}`);
    }

    const result = await response.json();
    logger.debug({result}, 'Rspamd check response');
    return result;
  } catch (err) {
    logger.error({error: err.message, url: `${RSPAMD_URL}/checkv2`}, 'Rspamd check request failed');
    throw err;
  }
}

/**
 * Trains Rspamd classifier with ham (non-spam) email
 * @param {string} emailContent - Raw email content including headers
 * @returns {Promise<Object>} - Parsed JSON response from Rspamd
 * @throws {Error} - If the request fails or Rspamd returns an error
 */
export async function learnHam(emailContent) {
  if (!emailContent) {
    throw new Error('Email content is required');
  }

  try {
    const response = await fetch(`${RSPAMD_URL}/learnham`, {
      method: 'POST',
      headers: buildHeaders(),
      body: emailContent
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Rspamd learn ham failed with status ${response.status}: ${error}`);
    }

    const result = await parseRspamdJson(response);
    logger.debug({result}, 'Rspamd learn ham response');

    if (result.success !== true) {
      if (isAlreadyLearned(result)) {
        logger.info({message: result.error}, 'Rspamd learn ham skipped');
        return {
          success: true,
          message: result.error,
          alreadyLearned: true
        };
      }
      throw new Error(`Rspamd learn ham failed: ${JSON.stringify(result) || 'Unknown error'}`);
    }

    return result;
  } catch (err) {
    logger.error({error: err.message, url: `${RSPAMD_URL}/learnham`}, 'Rspamd learn ham request failed');
    throw err;
  }
}

/**
 * Trains Rspamd classifier with spam email
 * @param {string} emailContent - Raw email content including headers
 * @returns {Promise<Object>} - Parsed JSON response from Rspamd
 * @throws {Error} - If the request fails or Rspamd returns an error
 */
export async function learnSpam(emailContent) {
  if (!emailContent) {
    throw new Error('Email content is required');
  }

  try {
    const response = await fetch(`${RSPAMD_URL}/learnspam`, {
      method: 'POST',
      headers: buildHeaders(),
      body: emailContent
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Rspamd learn spam failed with status ${response.status}: ${error}`);
    }

    const result = await parseRspamdJson(response);
    logger.debug({result}, 'Rspamd learn spam response');

    if (result.success !== true) {
      if (isAlreadyLearned(result)) {
        logger.info({message: result.error}, 'Rspamd learn spam skipped');
        return {
          success: true,
          message: result.error,
          alreadyLearned: true
        };
      }
      throw new Error(`Rspamd learn spam failed: ${JSON.stringify(result) || 'Unknown error'}`);
    }

    return result;
  } catch (err) {
    logger.error({error: err.message, url: `${RSPAMD_URL}/learnspam`}, 'Rspamd learn spam request failed');
    throw err;
  }
}
