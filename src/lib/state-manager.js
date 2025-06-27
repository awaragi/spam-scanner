export async function readScannerState() {
  return {
    last_uid: 12345,
    last_seen_date: new Date().toISOString(),
    last_checked: new Date().toISOString()
  };
}
export async function writeScannerState(state) {
  console.log("Writing state (stub)", state);
}
export async function deleteScannerState() {
  console.log("Deleting scanner state (stub)");
}