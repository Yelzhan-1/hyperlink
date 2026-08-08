/**
 * Validation shared by the encoder and the decoder.
 *
 * Both directions run the *same* checks, so a frame that this build emits is
 * by construction a frame this build accepts — and anything hand-crafted that
 * drifts from the schema is rejected identically on both ends.
 */

import { ProtocolError } from './errors.js';
import {
  DATE_KEYWORDS,
  ID_RE,
  INTENT_RE,
  KEY_RE,
  LIMITS,
  MESSAGE_TYPES,
  NATURAL_LANGUAGE_RE,
  TIME_KEYWORDS,
  VALUE_RE,
  paramSetFor,
} from './schema.js';

/** @typedef {import('./schema.js').MessageType} MessageType */
/** @typedef {import('./schema.js').ValueType} ValueType */
/** @typedef {import('./schema.js').ParamSet} ParamSet */

/**
 * @typedef {object} FrameParts
 * @property {MessageType} type
 * @property {string} intent
 * @property {Record<string, string>} params
 * @property {string} id
 * @property {string} [reply]
 */

const DATE_ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM_RE = /^([01]\d|2[0-3])[0-5]\d$/;

/**
 * @param {string} value
 * @param {ValueType} type
 * @returns {string | null} human-readable reason, or null when acceptable
 */
function checkTyped(value, type) {
  switch (type.kind) {
    case 'ENUM':
      return type.values.includes(value)
        ? null
        : `expected one of ${type.values.join('/')}`;
    case 'INT': {
      if (!/^-?\d+$/.test(value)) return 'expected an integer';
      const n = Number(value);
      if (n < type.min || n > type.max) return `out of range ${type.min}..${type.max}`;
      return null;
    }
    case 'TOKEN':
      return value.length <= type.maxLen ? null : `longer than ${type.maxLen} chars`;
    case 'DATE':
      if (DATE_KEYWORDS.includes(value)) return null;
      if (DATE_ISO_RE.test(value)) return null;
      return 'expected YYYY-MM-DD or a date keyword';
    case 'TIME':
      if (TIME_KEYWORDS.includes(value)) return null;
      if (HHMM_RE.test(value)) return null;
      return 'expected HHMM or a time keyword';
    case 'BOOL':
      return value === 'TRUE' || value === 'FALSE' ? null : 'expected TRUE or FALSE';
    default:
      return 'unknown type';
  }
}

/**
 * Guard against natural language leaking into the machine channel. This runs
 * *before* the character-class check so the caller gets the precise reason —
 * "you tried to put a sentence in a frame" — instead of a generic charset miss.
 * @param {string} key
 * @param {string} value
 */
export function assertNotNaturalLanguage(key, value) {
  if (NATURAL_LANGUAGE_RE.test(value)) {
    throw new ProtocolError(
      'E_NL_DETECTED',
      `natural language is not transmissible: ${key} contains prose or non-machine characters`,
      { key, value },
    );
  }
}

/**
 * @param {string} id
 * @param {'E_ID'|'E_REPLY'} code
 */
export function assertId(id, code) {
  if (typeof id !== 'string' || !ID_RE.test(id)) {
    throw new ProtocolError(code, `malformed message id: ${String(id)}`, { id });
  }
}

/**
 * @param {unknown} type
 * @returns {MessageType}
 */
export function assertType(type) {
  if (typeof type !== 'string' || !MESSAGE_TYPES.includes(/** @type {MessageType} */ (type))) {
    throw new ProtocolError('E_TYPE', `unknown message type: ${String(type)}`, { type });
  }
  return /** @type {MessageType} */ (type);
}

/**
 * @param {MessageType} type
 * @param {unknown} intent
 * @returns {ParamSet}
 */
export function assertIntent(type, intent) {
  if (typeof intent !== 'string' || !INTENT_RE.test(intent)) {
    throw new ProtocolError('E_INTENT', `malformed intent: ${String(intent)}`, { intent });
  }
  const set = paramSetFor(type, intent);
  if (!set) {
    throw new ProtocolError(
      'E_INTENT',
      `intent ${intent} is not part of ${type} in this protocol build`,
      { intent, type },
    );
  }
  return set;
}

/**
 * Validate a full parameter map against an intent's contract.
 * @param {Record<string, string>} params
 * @param {ParamSet} spec
 * @param {string} intent
 */
export function assertParams(params, spec, intent) {
  const keys = Object.keys(params);
  if (keys.length > LIMITS.MAX_PARAMS) {
    throw new ProtocolError('E_TOO_MANY_PARAMS', `more than ${LIMITS.MAX_PARAMS} parameters`, {
      count: keys.length,
    });
  }

  for (const key of keys) {
    if (!KEY_RE.test(key)) {
      throw new ProtocolError('E_PARAM_KEY', `malformed parameter key: ${key}`, { key });
    }
    if (key === 'ID' || key === 'REPLY') {
      throw new ProtocolError('E_PARAM_KEY', `${key} is a reserved frame field, not a parameter`, {
        key,
      });
    }
    const paramSpec = spec[key];
    if (!paramSpec) {
      throw new ProtocolError('E_PARAM_KEY', `${key} is not accepted by intent ${intent}`, {
        key,
        intent,
        accepted: Object.keys(spec),
      });
    }

    const value = params[key];
    if (typeof value !== 'string' || value.length === 0) {
      throw new ProtocolError('E_PARAM_VALUE', `${key} has an empty value`, { key });
    }
    assertNotNaturalLanguage(key, value);
    if (value.length > LIMITS.MAX_VALUE) {
      throw new ProtocolError('E_LENGTH', `${key} exceeds ${LIMITS.MAX_VALUE} characters`, {
        key,
        length: value.length,
      });
    }
    if (!VALUE_RE.test(value)) {
      throw new ProtocolError('E_PARAM_VALUE', `${key} uses characters outside the machine set`, {
        key,
        value,
      });
    }
    const reason = checkTyped(value, paramSpec.type);
    if (reason) {
      throw new ProtocolError('E_PARAM_VALUE', `${key}=${value}: ${reason}`, { key, value });
    }
  }

  for (const [key, paramSpec] of Object.entries(spec)) {
    if (paramSpec.required && !(key in params)) {
      throw new ProtocolError('E_REQUIRED', `intent ${intent} requires ${key}`, { key, intent });
    }
  }
}

/**
 * Full structural validation of an already-parsed frame.
 * @param {FrameParts} parts
 * @returns {FrameParts}
 */
export function assertFrameParts(parts) {
  const type = assertType(parts.type);
  const spec = assertIntent(type, parts.intent);
  assertId(parts.id, 'E_ID');
  if (parts.reply !== undefined) assertId(parts.reply, 'E_REPLY');
  assertParams(parts.params, spec, parts.intent);
  return parts;
}
