/**
 * AI backend selection.
 *
 * The rest of the platform never imports a concrete backend — it asks for one
 * by configuration. Adding a provider means adding a case here and nothing
 * else; no agent, protocol or transport code knows which model is answering.
 */

import { OllamaBackend } from './ollama.js';

/**
 * @typedef {object} Backend
 * @property {string} name
 * @property {string} model
 * @property {string} label
 * @property {() => Promise<{ok: boolean, reason?: string, models?: string[]}>} health
 * @property {(opts: {system: string, user: string, json?: boolean}) => Promise<string>} chat
 */

/**
 * @typedef {object} AiConfig
 * @property {string} provider
 * @property {string} ollamaBaseUrl
 * @property {string} ollamaModel
 * @property {number} timeoutMs
 * @property {boolean} allowFallback
 */

/**
 * @param {AiConfig} config
 * @returns {Backend}
 */
export function createBackend(config) {
  switch (config.provider) {
    case 'ollama':
      return new OllamaBackend({
        baseUrl: config.ollamaBaseUrl,
        model: config.ollamaModel,
        timeoutMs: config.timeoutMs,
      });
    default:
      throw new Error(
        `unknown AI_PROVIDER "${config.provider}" (supported: ollama)`,
      );
  }
}
