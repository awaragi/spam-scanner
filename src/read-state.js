import { readScannerState } from './lib/state-manager.js';

try {
  const state = await readScannerState();
  console.log(JSON.stringify(state, null, 2));
} catch (err) {
  console.error('Failed to read scanner state:', err.message);
  process.exit(1);
}