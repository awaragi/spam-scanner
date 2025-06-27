import { writeScannerState } from './lib/state-manager.js';
let data = '';
process.stdin.on('data', chunk => data += chunk);
process.stdin.on('end', async () => {
  const state = JSON.parse(data);
  await writeScannerState(state);
});