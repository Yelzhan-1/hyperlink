/**
 * AI reasoning core.
 *
 * Three capabilities, each of which returns *structured data* — never a
 * protocol frame, never a string that gets concatenated onto the wire:
 *
 *   understand(text)          human sentence  → { intent, params }
 *   resolve(task, world)      machine task    → { params }
 *   verbalize(result)         machine result  → human sentence
 *
 * Every model answer passes through normalize.js before anyone downstream sees
 * it. If the model is unreachable or its answer cannot be reduced to machine
 * tokens, the deterministic reasoner takes over and the result is labelled
 * `fallback`, so the UI can be honest about who actually did the thinking.
 */

import { createBackend } from './provider.js';
import * as fallback from './fallback.js';
import { extractJson, normalizeIntent, normalizeParams } from './normalize.js';
import {
  RESOLVE_SYSTEM,
  UNDERSTAND_SYSTEM,
  VERBALIZE_SYSTEM,
  resolveUser,
  understandUser,
  verbalizeUser,
} from './prompts.js';

/** @typedef {import('./provider.js').AiConfig} AiConfig */
/** @typedef {import('./provider.js').Backend} Backend */
/** @typedef {import('../protocol/validate.js').FrameParts} FrameParts */
/** @typedef {import('../domain/world.js').WorldResult} WorldResult */
/** @typedef {'model'|'fallback'} ReasoningSource */

/**
 * @typedef {object} Understanding
 * @property {string | null} intent
 * @property {Record<string, string>} params
 * @property {number} confidence
 * @property {ReasoningSource} source
 * @property {string} engine
 * @property {string[]} notes
 */

export class AiCore {
  /** @param {AiConfig} config */
  constructor(config) {
    /** @type {AiConfig} */
    this.config = config;
    /** @type {Backend} */
    this.backend = createBackend(config);
    /** @type {boolean} */
    this.online = false;
    /** @type {string} */
    this.status = 'UNPROBED';
  }

  /** @returns {string} badge text for the UI */
  get label() {
    return this.online ? this.backend.label : 'FALLBACK:DETERMINISTIC';
  }

  /**
   * Ask the backend whether it is actually usable. Called at boot and again
   * whenever a call fails, so a daemon that comes up mid-demo is picked up.
   * @returns {Promise<boolean>}
   */
  async probe() {
    const health = await this.backend.health();
    this.online = health.ok;
    this.status = health.ok ? 'ONLINE' : (health.reason ?? 'UNAVAILABLE');
    return this.online;
  }

  /**
   * @template T
   * @param {() => Promise<T>} run
   * @returns {Promise<T | null>} null when the model could not deliver
   */
  async #tryModel(run) {
    if (!this.online) return null;
    try {
      return await run();
    } catch (err) {
      this.online = false;
      this.status = err instanceof Error ? err.message : String(err);
      return null;
    }
  }

  /**
   * Human sentence → structured task parameters.
   * @param {string} humanText
   * @returns {Promise<Understanding>}
   */
  async understand(humanText) {
    /** @type {string[]} */
    const notes = [];

    const modelAnswer = await this.#tryModel(async () => {
      const raw = await this.backend.chat({
        system: UNDERSTAND_SYSTEM,
        user: understandUser(humanText),
        json: true,
      });
      const json = extractJson(raw);
      if (!json) throw new Error('model did not return JSON');
      return json;
    });

    if (modelAnswer) {
      const intent = normalizeIntent(modelAnswer.intent);
      if (intent) {
        const { params, dropped } = normalizeParams(
          'TASK',
          intent,
          /** @type {Record<string, unknown>} */ (modelAnswer.params ?? {}),
        );
        for (const d of dropped) notes.push(`dropped ${d.key}: ${d.reason}`);
        const confidence = typeof modelAnswer.confidence === 'number'
          ? Math.max(0, Math.min(1, modelAnswer.confidence))
          : 0.8;
        return {
          intent,
          params,
          confidence: Number(confidence.toFixed(2)),
          source: 'model',
          engine: this.backend.label,
          notes,
        };
      }
      notes.push(`model proposed an unknown intent: ${String(modelAnswer.intent)}`);
    }

    if (!this.config.allowFallback && !modelAnswer) {
      throw new Error(`AI backend unavailable: ${this.status}`);
    }

    const guess = fallback.understand(humanText);
    if (!guess.intent) {
      return {
        intent: null, params: {}, confidence: 0,
        source: 'fallback', engine: 'DETERMINISTIC', notes,
      };
    }
    const { params, dropped } = normalizeParams(
      'TASK', guess.intent, /** @type {Record<string, unknown>} */ (guess.params),
    );
    for (const d of dropped) notes.push(`dropped ${d.key}: ${d.reason}`);
    return {
      intent: guess.intent,
      params,
      confidence: guess.confidence,
      source: 'fallback',
      engine: 'DETERMINISTIC',
      notes,
    };
  }

  /**
   * Machine task + world facts → structured result parameters.
   *
   * The world model is authoritative; the model's job is to select and shape,
   * not to invent. Anything it returns that the contract does not accept is
   * dropped, and the world's own proposal fills the gap.
   *
   * @param {FrameParts} task
   * @param {WorldResult} world
   * @returns {Promise<{params: Record<string, string>, source: ReasoningSource, notes: string[]}>}
   */
  async resolve(task, world) {
    /** @type {string[]} */
    const notes = [];
    const baseline = normalizeParams(
      'RESULT', task.intent, /** @type {Record<string, unknown>} */ (world.params),
    ).params;

    const modelAnswer = await this.#tryModel(async () => {
      const raw = await this.backend.chat({
        system: RESOLVE_SYSTEM,
        user: resolveUser({
          intent: task.intent,
          params: task.params,
          facts: world.facts,
          suggested: world.params,
        }),
        json: true,
      });
      const json = extractJson(raw);
      if (!json) throw new Error('model did not return JSON');
      return json;
    });

    if (modelAnswer) {
      const proposed = /** @type {Record<string, unknown>} */ (
        modelAnswer.params ?? modelAnswer
      );
      const { params, dropped } = normalizeParams('RESULT', task.intent, proposed);
      for (const d of dropped) notes.push(`dropped ${d.key}: ${d.reason}`);
      const merged = { ...baseline, ...params };
      return { params: merged, source: 'model', notes };
    }

    return { params: baseline, source: 'fallback', notes };
  }

  /**
   * Machine result → one sentence for the human.
   * @param {{humanText: string, intent: string, params: Record<string, string>}} input
   * @returns {Promise<{text: string, source: ReasoningSource}>}
   */
  async verbalize(input) {
    const modelAnswer = await this.#tryModel(async () => {
      const raw = await this.backend.chat({
        system: VERBALIZE_SYSTEM,
        user: verbalizeUser(input),
      });
      const line = raw.split('\n').map((s) => s.trim()).filter(Boolean).join(' ').trim();
      if (line.length < 3) throw new Error('model returned an empty sentence');
      return line.slice(0, 400);
    });

    if (modelAnswer) return { text: modelAnswer, source: 'model' };
    return { text: fallback.verbalize(input), source: 'fallback' };
  }
}

export { fallback };
