/**
 * HYPERLINK / 0.1 — schema.
 *
 * This file is the single source of truth for what may legally exist inside a
 * HYPERLINK frame: the grammar, the character classes, the message types and
 * the intent registry with per-intent parameter contracts.
 *
 * It is intentionally free of any Node import so the *same* module runs in the
 * browser — the packet cards in the UI are rendered by the very same decoder
 * the server validates with.
 */

export const HL_VERSION = 'HL/0.1';
export const FIELD_SEP = '|';
export const KV_SEP = '=';

/** @typedef {'HELLO'|'TASK'|'RESULT'|'ERROR'} MessageType */

/** @type {readonly MessageType[]} */
export const MESSAGE_TYPES = ['HELLO', 'TASK', 'RESULT', 'ERROR'];

export const LIMITS = {
  /** Whole frame, characters. */
  MAX_FRAME: 512,
  MAX_PARAMS: 16,
  MAX_KEY: 24,
  MAX_VALUE: 32,
};

/**
 * Machine-safe character classes. Note what is *absent*: spaces, quotes,
 * lowercase, and every non-ASCII code point. A human sentence cannot survive
 * these patterns — which is exactly the point of the protocol.
 */
export const KEY_RE = /^[A-Z][A-Z0-9_]{0,23}$/;
// A leading '-' is allowed so negative measurements (TEMP_C=-8) can travel.
export const VALUE_RE = /^-?[A-Z0-9][A-Z0-9_.:+-]{0,31}$/;
export const ID_RE = /^[A-Z0-9]{3,16}$/;
export const INTENT_RE = /^[A-Z][A-Z0-9_]{0,31}$/;

/** Anything matching this in a candidate value is prose, not a machine token. */
export const NATURAL_LANGUAGE_RE = /[\s"'?!,;()]|[a-z]|[^\x00-\x7F]/;

/** @typedef {{kind:'ENUM', values:readonly string[]}} EnumType */
/** @typedef {{kind:'INT', min:number, max:number}} IntType */
/** @typedef {{kind:'TOKEN', maxLen:number}} TokenType */
/** @typedef {{kind:'DATE'}} DateType */
/** @typedef {{kind:'TIME'}} TimeType */
/** @typedef {{kind:'BOOL'}} BoolType */
/** @typedef {EnumType|IntType|TokenType|DateType|TimeType|BoolType} ValueType */

/** @typedef {{type: ValueType, required?: boolean, doc?: string}} ParamSpec */
/** @typedef {Readonly<Record<string, ParamSpec>>} ParamSet */
/** @typedef {{label: string, task: ParamSet, result: ParamSet}} IntentSpec */

/** @param {...string} values @returns {EnumType} */
export const asEnum = (...values) => ({ kind: 'ENUM', values });
/** @param {number} min @param {number} max @returns {IntType} */
export const asInt = (min, max) => ({ kind: 'INT', min, max });
/** @param {number} [maxLen] @returns {TokenType} */
export const asToken = (maxLen = LIMITS.MAX_VALUE) => ({ kind: 'TOKEN', maxLen });
/** @type {DateType} */
export const DATE = { kind: 'DATE' };
/** @type {TimeType} */
export const TIME = { kind: 'TIME' };
/** @type {BoolType} */
export const BOOL = { kind: 'BOOL' };

/** Symbolic dates a frame may carry in addition to YYYY-MM-DD. */
export const DATE_KEYWORDS = [
  'TODAY', 'TOMORROW', 'DAY_AFTER_TOMORROW', 'THIS_WEEK', 'NEXT_WEEK',
  'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN',
];

/** Symbolic times a frame may carry in addition to HHMM. */
export const TIME_KEYWORDS = [
  'NOW', 'MORNING', 'NOON', 'AFTERNOON', 'EVENING', 'NIGHT',
];

/**
 * The intent registry. `task` describes what may be asked, `result` describes
 * what may be answered. Anything not listed here is rejected by the encoder.
 * @type {Readonly<Record<string, IntentSpec>>}
 */
export const INTENTS = {
  RESTAURANT_BOOKING: {
    label: 'RESTAURANT BOOKING',
    task: {
      CITY: { type: asToken(24), required: true },
      PEOPLE: { type: asInt(1, 50), required: true },
      DATE: { type: DATE, required: true },
      TIME: { type: TIME },
      CUISINE: { type: asToken(24) },
    },
    result: {
      STATUS: { type: asEnum('AVAILABLE', 'UNAVAILABLE', 'PARTIAL'), required: true },
      TIME: { type: TIME },
      VENUE: { type: asToken(24) },
      SEATS: { type: asInt(1, 50) },
      TABLE: { type: asToken(12) },
    },
  },
  MEETING: {
    label: 'MEETING SLOT',
    task: {
      DATE: { type: DATE, required: true },
      TIME_AFTER: { type: TIME },
      TIME_BEFORE: { type: TIME },
      DURATION_MIN: { type: asInt(5, 480) },
      PEOPLE: { type: asInt(1, 50) },
    },
    result: {
      AVAILABLE: { type: BOOL, required: true },
      TIME: { type: TIME },
      DURATION_MIN: { type: asInt(5, 480) },
      ROOM: { type: asToken(16) },
    },
  },
  WEATHER: {
    label: 'WEATHER',
    task: {
      CITY: { type: asToken(24), required: true },
      DATE: { type: DATE, required: true },
    },
    result: {
      TEMP_C: { type: asInt(-90, 60), required: true },
      CONDITION: {
        type: asEnum('CLEAR', 'CLOUDY', 'RAIN', 'SNOW', 'STORM', 'FOG', 'WINDY'),
        required: true,
      },
      WIND_KPH: { type: asInt(0, 300) },
      HUMIDITY: { type: asInt(0, 100) },
    },
  },
  TAXI: {
    label: 'TAXI DISPATCH',
    task: {
      CITY: { type: asToken(24), required: true },
      FROM: { type: asToken(24), required: true },
      TO: { type: asToken(24), required: true },
      TIME: { type: TIME },
      PEOPLE: { type: asInt(1, 8) },
    },
    result: {
      STATUS: { type: asEnum('AVAILABLE', 'UNAVAILABLE'), required: true },
      ETA_MIN: { type: asInt(0, 240) },
      PRICE_KZT: { type: asInt(0, 1000000) },
      CAR: { type: asToken(20) },
    },
  },
  HOTEL_BOOKING: {
    label: 'HOTEL BOOKING',
    task: {
      CITY: { type: asToken(24), required: true },
      DATE: { type: DATE, required: true },
      GUESTS: { type: asInt(1, 20), required: true },
      NIGHTS: { type: asInt(1, 60) },
    },
    result: {
      STATUS: { type: asEnum('AVAILABLE', 'UNAVAILABLE', 'PARTIAL'), required: true },
      HOTEL: { type: asToken(24) },
      PRICE_KZT: { type: asInt(0, 100000000) },
      ROOMS: { type: asInt(0, 50) },
    },
  },
};

/** Capability handshake — how an agent announces it speaks HYPERLINK. */
export const HELLO_INTENT = 'CAPABILITY';

/** @type {ParamSet} */
export const HELLO_PARAMS = {
  AGENT: { type: asEnum('A', 'B'), required: true },
  ROLE: { type: asEnum('ORIGIN', 'RESPONDER'), required: true },
  INTENTS: { type: asInt(0, 999), required: true },
};

/** Errors are frames too — the peer must be able to machine-read a rejection. */
export const ERROR_INTENT = 'PROTOCOL';

/** @type {ParamSet} */
export const ERROR_PARAMS = {
  CODE: { type: asToken(24), required: true },
  AT: { type: asToken(24) },
};

/**
 * Resolve the parameter contract for a (type, intent) pair.
 * @param {MessageType} type
 * @param {string} intent
 * @returns {ParamSet | null} null when the pair is not part of the protocol
 */
export function paramSetFor(type, intent) {
  if (type === 'HELLO') return intent === HELLO_INTENT ? HELLO_PARAMS : null;
  if (type === 'ERROR') {
    if (intent === ERROR_INTENT) return ERROR_PARAMS;
    return intent in INTENTS ? ERROR_PARAMS : null;
  }
  const spec = INTENTS[intent];
  if (!spec) return null;
  return type === 'TASK' ? spec.task : spec.result;
}

/** @returns {string[]} every intent this build can speak */
export function knownIntents() {
  return Object.keys(INTENTS);
}
