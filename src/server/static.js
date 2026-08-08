/**
 * Static file serving.
 *
 * Three mounts, nothing else reachable:
 *   /            → src/frontend   (the UI)
 *   /audio/*     → src/audio      (the synthesiser)
 *   /protocol/*  → src/protocol   (the SAME protocol code the server runs)
 *
 * That third mount is the interesting one: the browser decodes packets with
 * the identical module the server validates with, so the UI cannot drift from
 * the wire format.
 */

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

/** @typedef {import('node:http').IncomingMessage} IncomingMessage */
/** @typedef {import('node:http').ServerResponse} ServerResponse */

const MIME = /** @type {Record<string, string>} */ ({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
});

/**
 * @param {string} srcDir absolute path to src/
 * @returns {{root: string, prefix: string}[]}
 */
function mounts(srcDir) {
  return [
    { prefix: '/audio/', root: resolve(srcDir, 'audio') },
    { prefix: '/protocol/', root: resolve(srcDir, 'protocol') },
    { prefix: '/', root: resolve(srcDir, 'frontend') },
  ];
}

/**
 * Resolve a URL path to a file inside one of the mounts, or null.
 * @param {string} srcDir
 * @param {string} urlPath
 * @returns {string | null}
 */
export function resolveStaticPath(srcDir, urlPath) {
  let pathname = urlPath.split('?')[0] ?? '/';
  try {
    pathname = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (pathname === '/' || pathname === '') pathname = '/index.html';
  if (pathname.includes('\0')) return null;

  for (const mount of mounts(srcDir)) {
    if (!pathname.startsWith(mount.prefix)) continue;
    const relative = normalize(pathname.slice(mount.prefix.length)).replace(/^(\.\.[/\\])+/, '');
    const candidate = resolve(join(mount.root, relative));
    // Containment check — no traversal out of the mount, ever.
    if (candidate !== mount.root && !candidate.startsWith(mount.root + sep)) continue;
    return candidate;
  }
  return null;
}

/**
 * @param {string} srcDir
 * @param {IncomingMessage} req
 * @param {ServerResponse} res
 * @returns {Promise<boolean>} true when the request was served
 */
export async function serveStatic(srcDir, req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  const filePath = resolveStaticPath(srcDir, req.url ?? '/');
  if (!filePath) return false;

  try {
    const info = await stat(filePath);
    if (!info.isFile()) return false;

    res.writeHead(200, {
      'content-type': MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
      'content-length': info.size,
      // A demo that shows stale code because of an HTTP cache is a bad demo.
      'cache-control': 'no-store',
    });
    if (req.method === 'HEAD') {
      res.end();
      return true;
    }
    await new Promise((done, fail) => {
      const stream = createReadStream(filePath);
      stream.on('error', fail);
      stream.on('end', () => done(undefined));
      stream.pipe(res);
    });
    return true;
  } catch {
    return false;
  }
}
