import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { mountFrontend, renderIndexHtml } from './frontend.js';

const INDEX = '<html><head><base href="/"></head><body>app</body></html>';

describe('renderIndexHtml', () => {
  test('rewrites the base tag to the runtime base URL', () => {
    expect(renderIndexHtml(INDEX, '/spam')).toContain('<base href="/spam/">');
    expect(renderIndexHtml(INDEX, '')).toContain('<base href="/">');
  });
});

describe('mountFrontend', () => {
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'frontend-'));
    writeFileSync(join(root, 'index.html'), INDEX);
    writeFileSync(join(root, 'main.js'), 'console.log(1)');
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  function appAt(baseUrl: string) {
    const app = express();
    mountFrontend(app, baseUrl, root);
    // Stand-in for Nest's own routes, mounted after the frontend.
    app.get(`${baseUrl}/api/ping`, (_req, res) => {
      res.json({ pong: true });
    });
    return app;
  }

  test.each(['', '/spam'])(
    'under %j: serves assets, falls back to index.html for SPA routes and leaves the API alone',
    async (baseUrl) => {
      const app = appAt(baseUrl);

      const asset = await request(app).get(`${baseUrl}/main.js`);
      expect(asset.status).toBe(200);
      expect(asset.text).toBe('console.log(1)');

      const route = await request(app).get(`${baseUrl}/admin/accounts/new`);
      expect(route.status).toBe(200);
      expect(route.text).toContain(`<base href="${baseUrl}/">`);

      const api = await request(app).get(`${baseUrl}/api/ping`);
      expect(api.body).toEqual({ pong: true });
    },
  );

  test('paths outside a non-empty base URL are not the frontend', async () => {
    const app = appAt('/spam');
    expect((await request(app).get('/')).status).toBe(404);
    expect((await request(app).get('/admin')).status).toBe(404);
    expect((await request(app).get('/spamx')).status).toBe(404);
  });

  test('is a no-op when there is no frontend build', async () => {
    const app = express();
    mountFrontend(app, '', join(root, 'missing'));
    expect((await request(app).get('/')).status).toBe(404);
  });
});
