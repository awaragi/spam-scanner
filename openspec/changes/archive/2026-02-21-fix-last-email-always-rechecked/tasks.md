## 1. Implementation

- [x] 1.1 Filter IMAP search results in `scan-workflow.js` to exclude UIDs ≤ `state.last_uid`

## 2. Testing

- [x] 2.1 Add `test/scan-workflow.test.js` with a unit test covering the IMAP UID range inversion scenario (search returns `[lastUID]`, assert filtered result is empty)
- [x] 2.2 Add unit test covering normal case (search returns UIDs > `last_uid`, assert all are enqueued)
- [x] 2.3 Add unit test covering mixed case (search returns both stale and new UIDs, assert only new ones pass through)
