/**
 * The ONLY component in HYPERLINK permitted to construct a frame.
 *
 * No other module — and in particular no AI output path — may concatenate a
 * frame string by hand. The AI produces a plain JSON object; that object is
 * normalised, then handed here, and this function either returns a frame that
 * is guaranteed valid or throws. There is no third outcome.
 */

import { ProtocolError } from './errors.js';
import { FIELD_SEP, HL_VERSION, KV_SEP, LIMITS } from './schema.js';
import { assertFrameParts } from './validate.js';

/** @typedef {import('./validate.js').FrameParts} FrameParts */
/** @typedef {import('./schema.js').MessageType} MessageType */

/**
 * @typedef {object} EncodeInput
 * @property {MessageType} type
 * @property {string} intent
 * @property {Record<string, string|number>} [params]
 * @property {string} id
 * @property {string} [reply]
 */

/**
 * Coerce numbers to their canonical string form. Everything else must already
 * be a machine token — we deliberately do NOT uppercase or strip here, because
 * silently repairing prose is how prose ends up on the wire. Normalisation is
 * the AI layer's job (src/ai/normalize.js); this layer only judges.
 * @param {Record<string, string|number>} params
 * @returns {Record<string, string>}
 */
function stringifyParams(params) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        throw new ProtocolError('E_PARAM_VALUE', `${key} is not a finite number`, { key });
      }
      out[key] = String(Math.trunc(value));
    } else if (typeof value === 'string') {
      out[key] = value;
    } else {
      throw new ProtocolError('E_PARAM_VALUE', `${key} must be a string or a number`, { key });
    }
  }
  return out;
}

/**
 * Build a validated HYPERLINK frame.
 * @param {EncodeInput} input
 * @returns {{frame: string, parts: FrameParts}}
 * @throws {ProtocolError} when anything at all is off-contract
 */
export function encodeFrame(input) {
  if (!input || typeof input !== 'object') {
    throw new ProtocolError('E_SYNTAX', 'encodeFrame requires an object');
  }
  const params = stringifyParams(input.params ?? {});

  /** @type {FrameParts} */
  const parts = assertFrameParts({
    type: input.type,
    intent: input.intent,
    params,
    id: input.id,
    ...(input.reply !== undefined ? { reply: input.reply } : {}),
  });

  // Canonical field order: version, type, intent, params (sorted), ID, REPLY.
  // Sorting makes encoding deterministic — the same task always produces the
  // same bytes, which matters for tests and for a reproducible demo.
  const fields = [HL_VERSION, parts.type, parts.intent];
  for (const key of Object.keys(parts.params).sort()) {
    fields.push(`${key}${KV_SEP}${parts.params[key]}`);
  }
  fields.push(`ID${KV_SEP}${parts.id}`);
  if (parts.reply !== undefined) fields.push(`REPLY${KV_SEP}${parts.reply}`);

  const frame = fields.join(FIELD_SEP);
  if (frame.length > LIMITS.MAX_FRAME) {
    throw new ProtocolError('E_LENGTH', `frame exceeds ${LIMITS.MAX_FRAME} characters`, {
      length: frame.length,
    });
  }
  return { frame, parts };
}
