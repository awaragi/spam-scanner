import { writeScannerState } from './lib/state-manager.js';

let input = '';
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', async () => {
  const state = JSON.parse(input);
  await writeScannerState(state);
});