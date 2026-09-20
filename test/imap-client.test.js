import { describe, test, expect, vi } from 'vitest';

vi.mock('../src/lib/utils/config.js', () => ({ config: {} }));
vi.mock('../src/lib/utils/logger.js', () => ({
  rootLogger: {
    forComponent: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

import { safeLogout } from '../src/lib/clients/imap-client.js';

describe('safeLogout', () => {
  test('calls imap.logout()', async () => {
    const imap = { logout: vi.fn().mockResolvedValue() };
    await safeLogout(imap);
    expect(imap.logout).toHaveBeenCalled();
  });

  test('swallows a logout failure rather than throwing (e.g. connect() never succeeded)', async () => {
    const imap = {
      logout: vi.fn().mockRejectedValue(new Error('no connection')),
    };
    await expect(safeLogout(imap)).resolves.toBeUndefined();
  });
});
