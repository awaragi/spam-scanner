/**
 * Runs an async function over items with a bounded number of concurrent workers.
 * Fully generic - no domain knowledge.
 * @param {Array} items
 * @param {number} limit
 * @param {(item: any) => Promise<any>} fn
 * @returns {Promise<Array>} - results in the same order as items
 */
export async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }

  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, worker));

  return results;
}
