import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import express, { type Express, type Request, type Response } from 'express';
import { API_PREFIX } from '../config/app-config.schema.js';

const BASE_TAG = /<base href="[^"]*"\s*\/?>/i;

/**
 * Points the built `index.html`'s `<base href>` at the runtime `BASE_URL`.
 * The Angular bundle is built once with `<base href="/">` and resolves both
 * its router and its (relative) API URLs against that tag, so rewriting it
 * here is all that's needed to serve the same build under any base.
 */
export function renderIndexHtml(html: string, baseUrl: string): string {
  return html.replace(BASE_TAG, `<base href="${baseUrl}/">`);
}

/**
 * Serves the built Angular app under `baseUrl`: static assets, plus an
 * `index.html` fallback for every other GET so client-side routes survive a
 * reload. API routes (and anything outside `baseUrl`) fall through to Nest.
 * A missing build (dev time, `npm run start:dev`) leaves everything to Nest.
 */
export function mountFrontend(
  server: Express,
  baseUrl: string,
  rootPath: string,
): void {
  let html: string;
  try {
    html = renderIndexHtml(
      readFileSync(join(rootPath, 'index.html'), 'utf8'),
      baseUrl,
    );
  } catch {
    return;
  }

  const apiRoot = `${baseUrl}/${API_PREFIX}`;
  const isApi = (path: string) =>
    path === apiRoot || path.startsWith(`${apiRoot}/`);
  const isInsideBase = (path: string) =>
    baseUrl === '' || path === baseUrl || path.startsWith(`${baseUrl}/`);

  const assets = express.static(rootPath, { index: false });
  server.use(baseUrl || '/', (req, res, next) =>
    isApi(req.originalUrl.split('?')[0]) ? next() : assets(req, res, next),
  );
  server.get('/{*path}', (req: Request, res: Response, next) => {
    if (!isInsideBase(req.path) || isApi(req.path)) return next();
    res.type('html').send(html);
  });
}
