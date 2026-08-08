/**
 * Frame → structure. Strict by construction: anything that does not parse
 * cleanly and validate against the schema is rejected, never "best-effort
 * repaired". A receiving agent acts only on what survives this file.
 */

import { ProtocolError } from './errors.js';
import { FIELD_SEP, HL_VERSION, KV_SEP, LIMITS } from './schema.js';
import { assertFrameParts } from './validate.js';

/** @typedef {import('./validate.js').FrameParts} FrameParts */
/** @typedef {import('./schema.js').MessageType} MessageType */

/**
 * @typedef {FrameParts & {version: string, raw: string}} DecodedFrame
 */

/**
 * Cheap shape test used by the transport as a tripwire before anything is
 * relayed. It answers "does this even claim to be a frame", not "is it valid".
 * @param {unknown} value
 * @returns {boolean}
 */
export function looksLikeFrame(value) {
  return typeof value === 'string' && value.startsWith(`${HL_VERSION}${FIELD_SEP}`);
}

/**
 * @param {unknown} raw
 * @returns {DecodedFrame}
 * @throws {ProtocolError}
 */
export function decodeFrame(raw) {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new ProtocolError('E_NOT_A_FRAME', 'frame must be a non-empty string');
  }
  if (raw.length > LIMITS.MAX_FRAME) {
    throw new ProtocolError('E_LENGTH', `frame exceeds ${LIMITS.MAX_FRAME} characters`, {
      length: raw.length,
    });
  }
  if (raw !== raw.trim()) {
    throw new ProtocolError('E_SYNTAX', 'frame has leading or trailing whitespace');
  }

  const fields = raw.split(FIELD_SEP);
  if (fields.length < 4) {
    throw new ProtocolError('E_SYNTAX', 'frame needs version, type, intent and ID', {
      fields: fields.length,
    });
  }

  const [version, type, intent, ...rest] = fields;
  if (version !== HL_VERSION) {
    throw new ProtocolError('E_VERSION', `unsupported protocol version: ${version}`, { version });
  }

  /** @type {Record<string, string>} */
  const params = {};
  /** @type {string | undefined} */
  let id;
  /** @type {string | undefined} */
  let reply;

  for (const field of rest) {
    const eq = field.indexOf(KV_SEP);
    if (eq <= 0) {
      throw new ProtocolError('E_SYNTAX', `field is not KEY=VALUE: ${field}`, { field });
    }
    const key = field.slice(0, eq);
    const value = field.slice(eq + 1);
    if (value.includes(KV_SEP)) {
      throw new ProtocolError('E_SYNTAX', `field has more than one '=': ${field}`, { field });
    }

    if (key === 'ID') {
      if (id !== undefined) throw new ProtocolError('E_DUP_KEY', 'duplicate ID field');
      id = value;
    } else if (key === 'REPLY') {
      if (reply !== undefined) throw new ProtocolError('E_DUP_KEY', 'duplicate REPLY field');
      reply = value;
    } else {
      if (key in params) throw new ProtocolError('E_DUP_KEY', `duplicate parameter: ${key}`, { key });
      params[key] = value;
    }
  }

  if (id === undefined) {
    throw new ProtocolError('E_ID', 'frame is missing its ID field');
  }

  const parts = assertFrameParts({
    type: /** @type {MessageType} */ (type),
    intent,
    params,
    id,
    ...(reply !== undefined ? { reply } : {}),
  });

  return { version, raw, ...parts };
}

/**
 * Validate without caring about the result — useful as a transport guard.
 * @param {unknown} raw
 * @returns {boolean}
 */
export function isValidFrame(raw) {
  try {
    decodeFrame(raw);
    return true;
  } catch {
    return false;
  }
}
