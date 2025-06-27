import { readScannerState } from './lib/state-manager.js';

const state = await readScannerState();
console.log(JSON.stringify(state, null, 2));