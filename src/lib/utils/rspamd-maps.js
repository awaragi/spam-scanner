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
 * Returns all lines (preserves empty lines, no sorting)
 */
async function readMapFile(mapPath) {
  try {
    const content = await fs.readFile(mapPath, 'utf-8');
    if (!content.trim()) {
      return [];
    }
    return content.split('\n');
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
 * Write entries to map file (one email per line, preserves empty lines)
 */
async function writeMapFile(mapPath, lines) {
  try {
    const dir = path.dirname(mapPath);
    await fs.mkdir(dir, {recursive: true});
    const content = lines.join('\n');
    await fs.writeFile(mapPath, content, 'utf-8');
    const emailCount = lines.filter(l => l.trim()).length;
    logger.debug({mapPath, count: emailCount}, 'Map file written');
  } catch (err) {
    logger.error({mapPath, error: err.message}, 'Error writing map file');
    throw err;
  }
}

/**
 * Update map file with new emails
 * - Preserves existing entries and empty lines
 * - Deduplicates entries
 * - Returns result with added/skipped count
 */
export async function updateMap(mapPath, newEmails) {
  try {
    // Read existing lines (preserves empty lines, maintains order)
    const lines = await readMapFile(mapPath);

    // Extract existing emails for deduplication
    const existingEmails = lines
      .map(normalizeEmail)
      .filter(email => email !== null);
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

    // Append new emails to existing lines (preserve structure)
    const outputLines = [...lines, ...added];
    await writeMapFile(mapPath, outputLines);

    logger.info({mapPath, addedCount: added.length, skippedCount: skipped.length, totalCount: existingSet.size}, 'Map file updated');

    return {
      added,
      skipped,
      total: existingSet.size,
    };
  } catch (err) {
    logger.error({mapPath, error: err.message}, 'Error updating map file');
    throw err;
  }
}

/**
 * Seed map file with initial entries
 * Overwrites existing file, preserves input order (no sorting)
 */
export async function seedMap(mapPath, emails) {
  try {
    // Normalize, deduplicate, preserve input order
    const uniqueEmails = [];
    const seen = new Set();

    for (const email of emails) {
      const normalized = normalizeEmail(email);
      if (normalized && !seen.has(normalized)) {
        uniqueEmails.push(normalized);
        seen.add(normalized);
      }
    }

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
