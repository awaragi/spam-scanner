import fs from 'fs/promises';
import path from 'path';
import pino from 'pino';

const logger = pino();

/**
 * Normalize email address: trim, lowercase
 */
function normalizeEmail(email) {
  if (!email || typeof email !== 'string') {
    return null;
  }
  const normalized = email.trim().toLowerCase();
  if (!normalized.includes('@')) {
    return null;
  }
  return normalized;
}

/**
 * Read existing entries from map file
 * Returns array of normalized email addresses (sorted)
 */
async function readMapFile(mapPath) {
  try {
    const content = await fs.readFile(mapPath, 'utf-8');
    if (!content.trim()) {
      return [];
    }
    return content
      .split('\n')
      .map(normalizeEmail)
      .filter(email => email !== null)
      .sort();
  } catch (err) {
    if (err.code === 'ENOENT') {
      logger.debug({mapPath}, 'Map file does not exist, starting with empty array');
      return [];
    }
    logger.error({mapPath, error: err.message}, 'Error reading map file');
    throw err;
  }
}

/**
 * Write entries to map file (one email per line)
 */
async function writeMapFile(mapPath, emails) {
  try {
    const dir = path.dirname(mapPath);
    await fs.mkdir(dir, {recursive: true});
    const content = emails.join('\n');
    await fs.writeFile(mapPath, content, 'utf-8');
    logger.debug({mapPath, count: emails.length}, 'Map file written');
  } catch (err) {
    logger.error({mapPath, error: err.message}, 'Error writing map file');
    throw err;
  }
}

/**
 * Update map file with new emails
 * - Preserves existing entries
 * - Deduplicates entries
 * - Returns result with added/skipped count
 */
export async function updateMap(mapPath, newEmails) {
  try {
    // Read existing entries
    const existingEmails = await readMapFile(mapPath);
    const existingSet = new Set(existingEmails);

    // Normalize and filter new emails
    const normalizedNewEmails = newEmails
      .map(normalizeEmail)
      .filter(email => email !== null);

    // Track added and skipped
    const added = [];
    const skipped = [];

    for (const email of normalizedNewEmails) {
      if (existingSet.has(email)) {
        skipped.push(email);
      } else {
        added.push(email);
        existingSet.add(email);
      }
    }

    // If no new emails, return early
    if (added.length === 0) {
      logger.debug({mapPath, skippedCount: skipped.length}, 'No new emails to add');
      return {
        added: [],
        skipped,
        total: existingSet.size,
      };
    }

    // Write updated list (existing + new)
    const allEmails = Array.from(existingSet).sort();
    await writeMapFile(mapPath, allEmails);

    logger.info({mapPath, addedCount: added.length, skippedCount: skipped.length, totalCount: allEmails.length}, 'Map file updated');

    return {
      added,
      skipped,
      total: allEmails.length,
    };
  } catch (err) {
    logger.error({mapPath, error: err.message}, 'Error updating map file');
    throw err;
  }
}

/**
 * Seed map file with initial entries
 * Overwrites existing file
 */
export async function seedMap(mapPath, emails) {
  try {
    const normalizedEmails = emails
      .map(normalizeEmail)
      .filter(email => email !== null);

    const uniqueEmails = Array.from(new Set(normalizedEmails)).sort();

    await writeMapFile(mapPath, uniqueEmails);

    logger.info({mapPath, count: uniqueEmails.length}, 'Map file seeded');

    return {
      total: uniqueEmails.length,
    };
  } catch (err) {
    logger.error({mapPath, error: err.message}, 'Error seeding map file');
    throw err;
  }
}
