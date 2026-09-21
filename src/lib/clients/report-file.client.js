import fs from 'fs/promises';
import path from 'path';
import { rootLogger } from '../core/logger.js';

const logger = rootLogger.forComponent('report-file-client');

/**
 * Turns a Date into a filesystem-safe timestamp, e.g. "2026-09-20T14-30-00".
 * @param {Date} date
 * @returns {string}
 */
function timestampFor(date) {
  return date.toISOString().replace(/:/g, '-').split('.')[0];
}

/**
 * Writes report text to a new timestamped file under `<reportsDir>/`, never
 * overwriting a previous run's report (see the `ai-prompt-eval` capability's
 * "Timestamped, non-overwriting report output" requirement).
 * @param {string} reportsDir
 * @param {string} reportText
 * @param {Date} [generatedAt]
 * @returns {Promise<string>} the written file's path
 */
export async function writeReport(
  reportsDir,
  reportText,
  generatedAt = new Date()
) {
  await fs.mkdir(reportsDir, { recursive: true });
  const filePath = path.join(reportsDir, `${timestampFor(generatedAt)}.txt`);
  await fs.writeFile(filePath, reportText, 'utf-8');
  logger.info({ filePath }, 'Prompt eval report written');
  return filePath;
}
