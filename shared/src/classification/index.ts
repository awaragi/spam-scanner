export { isPermanentError } from './error-classifier.js';
export {
  categorizeMessages,
  applyAiEscalation,
  applyWhitelistAdjustment,
  applyWhitelistAdjustments,
  partitionByWhitelistFlag,
  mergeWhitelistedBack,
} from './spam-classifier.js';
