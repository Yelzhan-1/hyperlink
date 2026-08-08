/**
 * Configuration.
 *
 * Reads .env if one exists, then the real environment (which always wins), and
 * produces a single frozen config object. No module reads process.env directly.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Minimal .env parser — KEY=VALUE, # comments, optional quotes.
 * @param {string} text
 * @returns {Record<string, string>}
 */
export function parseEnvFile(text) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/**
 * @param {string} rootDir
 * @returns {Record<string, string|undefined>}
 */
function readEnv(rootDir) {
  /** @type {Record<string, string|undefined>} */
  let fileValues = {};
  try {
    fileValues = parseEnvFile(readFileSync(resolve(rootDir, '.env'), 'utf8'));
  } catch {
    // No .env is the normal case — every default below is usable as-is.
  }
  return { ...fileValues, ...process.env };
}

/**
 * @typedef {object} Config
 * @property {number} port
 * @property {string} host
 * @property {string} provider
 * @property {string} ollamaBaseUrl
 * @property {string} ollamaModel
 * @property {number} timeoutMs
 * @property {boolean} allowFallback
 * @property {number} stageDelayMs
 */

/**
 * @param {string} rootDir project root
 * @returns {Readonly<Config>}
 */
export function loadConfig(rootDir) {
  const env = readEnv(rootDir);

  /** @param {string|undefined} value @param {number} fallback @returns {number} */
  const num = (value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };

  return Object.freeze({
    port: num(env.PORT, 3000),
    host: env.HOST && env.HOST.trim() !== '' ? env.HOST : '0.0.0.0',
    provider: (env.AI_PROVIDER ?? 'ollama').trim().toLowerCase(),
    ollamaBaseUrl: (env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434').trim(),
    ollamaModel: (env.OLLAMA_MODEL ?? 'llama3.2').trim(),
    timeoutMs: num(env.AI_TIMEOUT_MS, 25000),
    allowFallback: (env.AI_FALLBACK ?? 'true').toLowerCase() !== 'false',
    stageDelayMs: num(env.STAGE_DELAY_MS, 420),
  });
}
