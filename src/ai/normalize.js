/**
 * The airlock between "what a language model said" and "what the protocol
 * accepts".
 *
 * A model — any model — will hand you {"city": "Almaty", "people": "four"}
 * sooner or later. This module coerces that into machine tokens *or gives up*.
 * It never smuggles prose through: if a value still contains a space, a
 * question mark or Cyrillic after normalisation, it is dropped, and the encoder
 * rejects the message rather than transmit a sentence.
 */

import {
  DATE_KEYWORDS,
  INTENTS,
  NATURAL_LANGUAGE_RE,
  TIME_KEYWORDS,
  VALUE_RE,
  paramSetFor,
} from '../protocol/schema.js';

/** @typedef {import('../protocol/schema.js').MessageType} MessageType */
/** @typedef {import('../protocol/schema.js').ValueType} ValueType */

/** Small multilingual number words — models love spelling numbers out. */
const NUMBER_WORDS = /** @type {Record<string, number>} */ ({
  ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5, SIX: 6, SEVEN: 7, EIGHT: 8, NINE: 9, TEN: 10,
  ELEVEN: 11, TWELVE: 12,
  // Durations get spoken in round numbers ("thirty minutes"), so the tens
  // matter as much as the digits do.
  FIFTEEN: 15, TWENTY: 20, THIRTY: 30, FORTY: 40, FORTY_FIVE: 45, FIFTY: 50,
  SIXTY: 60, NINETY: 90,
  ОДИН: 1, ДВА: 2, ТРИ: 3, ЧЕТЫРЕ: 4, ПЯТЬ: 5, ШЕСТЬ: 6, СЕМЬ: 7, ВОСЕМЬ: 8, ДЕВЯТЬ: 9, ДЕСЯТЬ: 10,
  ПЯТНАДЦАТЬ: 15, ДВАДЦАТЬ: 20, ТРИДЦАТЬ: 30, СОРОК: 40, ШЕСТЬДЕСЯТ: 60, ДЕВЯНОСТО: 90,
  БІР: 1, ЕКІ: 2, ҮШ: 3, ТӨРТ: 4, БЕС: 5,
});

/** Cyrillic → Latin, so "Алматы" survives as ALMATY instead of being dropped. */
const TRANSLIT = /** @type {Record<string, string>} */ ({
  А: 'A', Ә: 'A', Б: 'B', В: 'V', Г: 'G', Ғ: 'G', Д: 'D', Е: 'E', Ё: 'E', Ж: 'ZH', З: 'Z',
  И: 'I', Й: 'Y', І: 'I', К: 'K', Қ: 'Q', Л: 'L', М: 'M', Н: 'N', Ң: 'N', О: 'O', Ө: 'O',
  П: 'P', Р: 'R', С: 'S', Т: 'T', У: 'U', Ұ: 'U', Ү: 'U', Ф: 'F', Х: 'H', Һ: 'H', Ц: 'TS',
  Ч: 'CH', Ш: 'SH', Щ: 'SCH', Ъ: '', Ы: 'Y', Ь: '', Э: 'E', Ю: 'YU', Я: 'YA',
});

/** Free-text time words the model may echo instead of a keyword. */
const TIME_WORDS = /** @type {Record<string, string>} */ ({
  MORNING: 'MORNING', УТРО: 'MORNING', УТРОМ: 'MORNING', ТАН: 'MORNING',
  NOON: 'NOON', MIDDAY: 'NOON', ПОЛДЕНЬ: 'NOON',
  AFTERNOON: 'AFTERNOON', ДЕНЬ: 'AFTERNOON', ДНЕМ: 'AFTERNOON',
  EVENING: 'EVENING', ВЕЧЕР: 'EVENING', ВЕЧЕРОМ: 'EVENING', КЕШ: 'EVENING',
  NIGHT: 'NIGHT', НОЧЬ: 'NIGHT', НОЧЬЮ: 'NIGHT',
  NOW: 'NOW', СЕЙЧАС: 'NOW', ASAP: 'NOW',
});

/** Free-text date words. */
const DATE_WORDS = /** @type {Record<string, string>} */ ({
  TODAY: 'TODAY', СЕГОДНЯ: 'TODAY', БУГІН: 'TODAY',
  TOMORROW: 'TOMORROW', ЗАВТРА: 'TOMORROW', ЕРТЕН: 'TOMORROW',
  DAY_AFTER_TOMORROW: 'DAY_AFTER_TOMORROW', ПОСЛЕЗАВТРА: 'DAY_AFTER_TOMORROW',
  MONDAY: 'MON', TUESDAY: 'TUE', WEDNESDAY: 'WED', THURSDAY: 'THU',
  FRIDAY: 'FRI', SATURDAY: 'SAT', SUNDAY: 'SUN',
});

/**
 * @param {string} value
 * @returns {string}
 */
function transliterate(value) {
  let out = '';
  for (const ch of value) {
    out += ch in TRANSLIT ? TRANSLIT[ch] : ch;
  }
  return out;
}

/**
 * Turn "7 PM", "19:30", "7pm" into HHMM. Returns null when it is not a clock.
 * @param {string} raw
 * @returns {string | null}
 */
export function parseClock(raw) {
  const s = raw.trim().toUpperCase();
  const m = s.match(/^(\d{1,2})[:.]?(\d{2})?\s*(AM|PM|A\.M\.|P\.M\.)?$/);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = Number(m[2] ?? '0');
  const meridiem = (m[3] ?? '').replace(/\./g, '');
  if (Number.isNaN(hour) || Number.isNaN(minute) || minute > 59) return null;
  if (meridiem === 'PM' && hour < 12) hour += 12;
  if (meridiem === 'AM' && hour === 12) hour = 0;
  if (hour > 23) return null;
  return `${String(hour).padStart(2, '0')}${String(minute).padStart(2, '0')}`;
}

/**
 * Coerce one loose value toward a machine token.
 * @param {string} key
 * @param {unknown} raw
 * @param {ValueType} [type]
 * @returns {string | null} null = unsalvageable, drop it
 */
export function normalizeValue(key, raw, type) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'boolean') return raw ? 'TRUE' : 'FALSE';
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? String(Math.trunc(raw)) : null;
  }
  if (typeof raw !== 'string') return null;

  let value = raw.trim();
  if (value === '') return null;

  const kind = type ? type.kind : undefined;

  // Clock-ish values get a dedicated pass before generic squashing, because
  // "19:30" and "7 PM" both need to become 1930 and neither survives naively.
  if (kind === 'TIME') {
    const clock = parseClock(value);
    if (clock) return clock;
  }
  if (kind === 'DATE' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const upper = value.toUpperCase();

  // Keyword lookups run on the original script first: transliterating
  // "ВЕЧЕРОМ" to VECHEROM would lose the very word we are trying to recognise.
  if (kind === 'TIME') {
    if (TIME_KEYWORDS.includes(upper)) return upper;
    if (upper in TIME_WORDS) return TIME_WORDS[upper] ?? null;
  }
  if (kind === 'DATE') {
    if (DATE_KEYWORDS.includes(upper)) return upper;
    if (upper in DATE_WORDS) return DATE_WORDS[upper] ?? null;
  }
  if (kind === 'INT' && upper in NUMBER_WORDS) return String(NUMBER_WORDS[upper]);

  value = transliterate(upper);

  if (kind === 'TIME') {
    if (TIME_KEYWORDS.includes(value)) return value;
    return value in TIME_WORDS ? TIME_WORDS[value] ?? null : null;
  }
  if (kind === 'DATE') {
    if (DATE_KEYWORDS.includes(value)) return value;
    return value in DATE_WORDS ? DATE_WORDS[value] ?? null : null;
  }

  if (kind === 'INT') {
    if (value in NUMBER_WORDS) return String(NUMBER_WORDS[value]);
    const digits = value.match(/-?\d+/);
    return digits ? digits[0] : null;
  }

  if (kind === 'BOOL') {
    if (/^(TRUE|YES|AVAILABLE|OK|1)$/.test(value)) return 'TRUE';
    if (/^(FALSE|NO|UNAVAILABLE|0)$/.test(value)) return 'FALSE';
    return null;
  }

  // Before squashing, refuse anything that is obviously a sentence rather than
  // a name. Without this, transliteration is too *good* at its job: it would
  // happily turn "Какая погода сегодня?" into KAKAYA_POGODA_SEGODNYA, which is
  // a machine-legal token carrying a human question — precisely the smuggling
  // the protocol exists to prevent. A place name is a word or three, never a
  // clause, and never punctuated.
  if (/[?!;]/.test(raw)) return null;
  if (raw.trim().split(/\s+/).length > 3) return null;

  // Generic token squash: separators become underscores, decorations vanish.
  value = value
    .replace(/['"«»`]/g, '')
    .replace(/[\s/\\,]+/g, '_')
    .replace(/[^A-Z0-9_.:+-]/g, '')
    .replace(/_{2,}/g, '_')
    .replace(/^[_.:+-]+|[_.:+-]+$/g, '');

  if (value === '') return null;
  // At most three underscore-joined words (NEW_YORK, DAY_AFTER_TOMORROW).
  if ((value.match(/_/g) ?? []).length > 2) return null;
  if (NATURAL_LANGUAGE_RE.test(value)) return null;
  if (!VALUE_RE.test(value)) return null;
  if (type && type.kind === 'ENUM' && !type.values.includes(value)) return null;

  return value;
}

/**
 * @typedef {{key: string, value: unknown, reason: string}} DroppedParam
 */

/**
 * Normalise a whole parameter bag against an intent's contract, dropping every
 * key the protocol does not know and every value that cannot be rescued.
 *
 * @param {MessageType} messageType
 * @param {string} intent
 * @param {Record<string, unknown>} raw
 * @returns {{params: Record<string, string>, dropped: DroppedParam[]}}
 */
export function normalizeParams(messageType, intent, raw) {
  const spec = paramSetFor(messageType, intent);
  /** @type {Record<string, string>} */
  const params = {};
  /** @type {DroppedParam[]} */
  const dropped = [];

  if (!spec) return { params, dropped };

  for (const [rawKey, rawValue] of Object.entries(raw ?? {})) {
    const key = String(rawKey).trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    const paramSpec = spec[key];
    if (!paramSpec) {
      dropped.push({ key, value: rawValue, reason: 'not in intent contract' });
      continue;
    }
    const value = normalizeValue(key, rawValue, paramSpec.type);
    if (value === null) {
      dropped.push({ key, value: rawValue, reason: 'not reducible to a machine token' });
      continue;
    }
    params[key] = value;
  }
  return { params, dropped };
}

/**
 * @param {unknown} intent
 * @returns {string | null} a known intent name, or null
 */
export function normalizeIntent(intent) {
  if (typeof intent !== 'string') return null;
  const name = intent.trim().toUpperCase().replace(/[\s-]+/g, '_');
  return name in INTENTS ? name : null;
}

/**
 * Models wrap JSON in prose or fences no matter how firmly you ask them not to.
 * Pull the first balanced object out of the text.
 * @param {string} text
 * @returns {Record<string, unknown> | null}
 */
export function extractJson(text) {
  if (typeof text !== 'string') return null;
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < cleaned.length; i += 1) {
    const ch = cleaned[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(cleaned.slice(start, i + 1));
          return typeof parsed === 'object' && parsed !== null
            ? /** @type {Record<string, unknown>} */ (parsed)
            : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
