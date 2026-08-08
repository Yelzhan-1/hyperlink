/**
 * Deterministic reasoner — the stage safety net.
 *
 * HYPERLINK reasons with a real model (Ollama) by default. But a live demo on
 * someone else's Wi-Fi, with someone else's laptop, must not depend on a
 * daemon being up. When the model backend is unreachable or returns something
 * unusable, the agents fall back to this module and the UI says so plainly:
 * the badge reads FALLBACK, never OLLAMA.
 *
 * It is a rule engine, not a language model. It is honest about that.
 */

import { INTENTS } from '../protocol/schema.js';

/** @typedef {import('./normalize.js').DroppedParam} DroppedParam */

/** Cities the demo knows by name, in Latin and Cyrillic spellings. */
const CITIES = /** @type {Record<string, string>} */ ({
  ALMATY: 'ALMATY', АЛМАТЫ: 'ALMATY', АЛМА: 'ALMATY',
  ASTANA: 'ASTANA', АСТАНА: 'ASTANA', NURSULTAN: 'ASTANA',
  SHYMKENT: 'SHYMKENT', ШЫМКЕНТ: 'SHYMKENT',
  KARAGANDA: 'KARAGANDA', КАРАГАНДА: 'KARAGANDA',
  MOSCOW: 'MOSCOW', МОСКВА: 'MOSCOW', МОСКВЕ: 'MOSCOW',
  DUBAI: 'DUBAI', ДУБАЙ: 'DUBAI',
  ISTANBUL: 'ISTANBUL', СТАМБУЛ: 'ISTANBUL',
  LONDON: 'LONDON', ЛОНДОН: 'LONDON',
  PARIS: 'PARIS', ПАРИЖ: 'PARIS',
  BERLIN: 'BERLIN', БЕРЛИН: 'BERLIN',
  TOKYO: 'TOKYO', ТОКИО: 'TOKYO',
});

/**
 * Intent keyword weights. Highest total score wins.
 *
 * Latin keywords are matched as whole words, never as substrings: "EAT" lives
 * inside "w-EAT-her" and "HOT" inside "HOTel", and naive substring matching
 * sends the weather demo to the restaurant agent. Cyrillic entries are stems
 * (Russian inflects heavily) and are matched as prefixes on purpose.
 */
const INTENT_KEYWORDS = /** @type {Record<string, string[]>} */ ({
  RESTAURANT_BOOKING: [
    'RESTAURANT', 'TABLE', 'BOOK', 'BOOKING', 'RESERVE', 'RESERVATION',
    'DINNER', 'LUNCH', 'EAT', 'DINE',
    'РЕСТОРАН', 'СТОЛИК', 'ЗАБРОНИР', 'БРОНЬ', 'УЖИН', 'ОБЕД', 'ПОЕСТЬ',
  ],
  MEETING: [
    'MEETING', 'MEET', 'CALL', 'SLOT', 'SCHEDULE', 'CALENDAR', 'APPOINTMENT', 'SYNC',
    'ВСТРЕЧ', 'СОЗВОН', 'РАСПИСАН', 'КАЛЕНДАР', 'СЛОТ',
  ],
  WEATHER: [
    'WEATHER', 'FORECAST', 'TEMPERATURE', 'RAIN', 'RAINING', 'SNOW', 'SNOWING',
    'HOT', 'COLD', 'SUNNY',
    'ПОГОД', 'ТЕМПЕРАТУР', 'ДОЖД', 'СНЕГ', 'ПРОГНОЗ',
  ],
  TAXI: [
    'TAXI', 'CAB', 'RIDE', 'DRIVER', 'PICKUP', 'AIRPORT',
    'ТАКСИ', 'МАШИН', 'ПОЕЗДК', 'ВОДИТЕЛ', 'АЭРОПОРТ',
  ],
  HOTEL_BOOKING: [
    'HOTEL', 'HOTELS', 'ROOM', 'ROOMS', 'STAY', 'NIGHT', 'NIGHTS', 'ACCOMMODATION',
    'ОТЕЛ', 'ГОСТИНИЦ', 'НОМЕР', 'НОЧ', 'ПРОЖИВАН',
  ],
});

/** ASCII keywords match whole words; non-ASCII stems match as prefixes. */
const ASCII_ONLY = /^[A-Z]+$/;

/**
 * @param {string} upper haystack, already uppercased
 * @param {string} keyword
 * @returns {boolean}
 */
function hasKeyword(upper, keyword) {
  if (!ASCII_ONLY.test(keyword)) return upper.includes(keyword);
  return new RegExp(`\\b${keyword}\\b`).test(upper);
}

const NUMBER_WORDS = /** @type {Record<string, number>} */ ({
  ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5, SIX: 6, SEVEN: 7, EIGHT: 8, NINE: 9, TEN: 10,
  ОДИН: 1, ДВОИХ: 2, ДВА: 2, ТРОИХ: 3, ТРИ: 3, ЧЕТВЕРЫХ: 4, ЧЕТЫРЕ: 4, ПЯТЕРЫХ: 5, ПЯТЬ: 5,
  ШЕСТЬ: 6, СЕМЬ: 7, ВОСЕМЬ: 8,
});

/**
 * @param {string} text
 * @returns {boolean} true when the human wrote in Cyrillic
 */
export function isCyrillic(text) {
  return /[А-Яа-яЁё]/.test(text);
}

/**
 * @param {string} upper
 * @returns {string | null}
 */
function findCity(upper) {
  for (const [needle, city] of Object.entries(CITIES)) {
    if (upper.includes(needle)) return city;
  }
  return null;
}

/**
 * @param {string} upper
 * @returns {{date?: string}}
 */
function findDate(upper) {
  if (/(DAY AFTER TOMORROW|ПОСЛЕЗАВТРА)/.test(upper)) return { date: 'DAY_AFTER_TOMORROW' };
  if (/(TOMORROW|ЗАВТРА|ЕРТЕН)/.test(upper)) return { date: 'TOMORROW' };
  if (/(TODAY|TONIGHT|СЕГОДНЯ|БУГІН)/.test(upper)) return { date: 'TODAY' };
  const iso = upper.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso && iso[1]) return { date: iso[1] };
  return {};
}

/**
 * Pull a clock time out of prose: "after 6 PM", "в 19:30", "at 7".
 * @param {string} upper
 * @returns {{time?: string, after?: string, window?: string}}
 */
function findTime(upper) {
  /** @param {string} h @param {string} [m] @param {string} [mer] @returns {string} */
  const toHHMM = (h, m, mer) => {
    let hour = Number(h);
    const minute = Number(m ?? '0');
    if (mer === 'PM' && hour < 12) hour += 12;
    if (mer === 'AM' && hour === 12) hour = 0;
    // A bare "at 7" for dinner or an evening meeting means 19:00, not 07:00.
    if (!mer && hour <= 11 && /(EVENING|DINNER|ВЕЧЕР|УЖИН|PM)/.test(upper)) hour += 12;
    if (hour > 23) hour = 23;
    return `${String(hour).padStart(2, '0')}${String(minute).padStart(2, '0')}`;
  };

  const clock = upper.match(/\b(\d{1,2})(?:[:.](\d{2}))?\s*(AM|PM)?\b(?!\s*(PEOPLE|PERSON|GUEST|ЧЕЛОВЕК))/);
  const isAfter = /(AFTER|LATER THAN|ПОСЛЕ|ПОЗЖЕ)/.test(upper);

  if (clock && clock[1] && (clock[3] || Number(clock[1]) <= 24) && /\b(AT|AFTER|BY|BEFORE|В|ПОСЛЕ|К)\b|\d{1,2}\s*(AM|PM)|:\d{2}/.test(upper)) {
    const hhmm = toHHMM(clock[1], clock[2], clock[3]);
    return isAfter ? { after: hhmm } : { time: hhmm };
  }
  if (/(EVENING|TONIGHT|ВЕЧЕР|КЕШ)/.test(upper)) return { window: 'EVENING' };
  if (/(MORNING|УТР|ТАН)/.test(upper)) return { window: 'MORNING' };
  if (/(AFTERNOON|ДНЕМ|ДЕНЬ)/.test(upper)) return { window: 'AFTERNOON' };
  if (/(NIGHT|НОЧ)/.test(upper)) return { window: 'NIGHT' };
  return {};
}

/**
 * @param {string} upper
 * @returns {number | null}
 */
function findPeople(upper) {
  const explicit = upper.match(/\b(\d{1,2})\s*(PEOPLE|PERSONS?|GUESTS?|PAX|ЧЕЛОВЕК|ЧЕЛ|ГОСТ)/);
  if (explicit && explicit[1]) return Number(explicit[1]);
  const forN = upper.match(/\b(?:FOR|НА)\s+(\d{1,2}|[A-ZА-Я]+)\b/);
  if (forN && forN[1]) {
    const token = forN[1];
    if (/^\d+$/.test(token)) return Number(token);
    if (token in NUMBER_WORDS) return NUMBER_WORDS[token] ?? null;
  }
  for (const [word, n] of Object.entries(NUMBER_WORDS)) {
    if (new RegExp(`\\b${word}\\s+(PEOPLE|ЧЕЛОВЕК|ГОСТ)`).test(upper)) return n;
  }
  return null;
}

/**
 * Human sentence → structured intent, without a language model.
 * @param {string} text
 * @returns {{intent: string|null, params: Record<string, string|number>, confidence: number}}
 */
export function understand(text) {
  const upper = text.toUpperCase();

  /** @type {{name: string, score: number} | null} */
  let best = null;
  for (const [name, words] of Object.entries(INTENT_KEYWORDS)) {
    let score = 0;
    for (const word of words) if (hasKeyword(upper, word)) score += 1;
    if (score > 0 && (!best || score > best.score)) best = { name, score };
  }
  if (!best) return { intent: null, params: {}, confidence: 0 };

  const city = findCity(upper);
  const { date } = findDate(upper);
  const time = findTime(upper);
  const people = findPeople(upper);

  /** @type {Record<string, string|number>} */
  const params = {};

  switch (best.name) {
    case 'RESTAURANT_BOOKING':
      params.CITY = city ?? 'ALMATY';
      params.PEOPLE = people ?? 2;
      params.DATE = date ?? 'TODAY';
      if (time.time) params.TIME = time.time;
      else if (time.after) params.TIME = time.after;
      else if (time.window) params.TIME = time.window;
      break;

    case 'MEETING':
      params.DATE = date ?? 'TOMORROW';
      if (time.after) params.TIME_AFTER = time.after;
      else if (time.time) params.TIME_AFTER = time.time;
      else if (time.window) params.TIME_AFTER = time.window;
      if (people) params.PEOPLE = people;
      params.DURATION_MIN = 30;
      break;

    case 'WEATHER':
      params.CITY = city ?? 'ALMATY';
      params.DATE = date ?? 'TODAY';
      break;

    case 'TAXI': {
      params.CITY = city ?? 'ALMATY';
      const airport = /(AIRPORT|АЭРОПОРТ)/.test(upper);
      params.FROM = airport ? 'CITY_CENTER' : 'CURRENT_LOCATION';
      params.TO = airport ? 'AIRPORT' : 'CITY_CENTER';
      if (time.time) params.TIME = time.time;
      else params.TIME = 'NOW';
      if (people) params.PEOPLE = Math.min(people, 8);
      break;
    }

    case 'HOTEL_BOOKING': {
      params.CITY = city ?? 'ALMATY';
      params.DATE = date ?? 'TODAY';
      params.GUESTS = people ?? 1;
      const nights = upper.match(/\b(\d{1,2})\s*(NIGHTS?|НОЧ)/);
      if (nights && nights[1]) params.NIGHTS = Number(nights[1]);
      break;
    }

    default:
      break;
  }

  // Confidence reflects how much of the contract we actually filled.
  const spec = INTENTS[best.name];
  const required = spec ? Object.entries(spec.task).filter(([, s]) => s.required).length : 1;
  const filled = spec
    ? Object.entries(spec.task).filter(([k, s]) => s.required && k in params).length
    : 0;
  const confidence = Math.min(0.95, 0.45 + 0.1 * best.score + 0.3 * (filled / Math.max(required, 1)));

  return { intent: best.name, params, confidence: Number(confidence.toFixed(2)) };
}

/**
 * Structured result → one human sentence, without a language model.
 * @param {{humanText: string, intent: string, params: Record<string, string>}} input
 * @returns {string}
 */
export function verbalize(input) {
  const ru = isCyrillic(input.humanText);
  const p = input.params;
  /** @param {string|undefined} t @returns {string} */
  const clock = (t) => (t && /^\d{4}$/.test(t) ? `${t.slice(0, 2)}:${t.slice(2)}` : String(t ?? ''));
  /** @param {string|undefined} name @returns {string} */
  const pretty = (name) => String(name ?? '').replace(/_/g, ' ');

  switch (input.intent) {
    case 'RESTAURANT_BOOKING':
      if (p.STATUS === 'UNAVAILABLE') {
        return ru ? 'Агент B не нашёл свободных столиков.' : 'Agent B found no free tables.';
      }
      return ru
        ? `Агент B нашёл столик в «${pretty(p.VENUE)}» на ${clock(p.TIME)}${p.SEATS ? `, мест: ${p.SEATS}` : ''}.`
        : `Agent B booked a table at ${pretty(p.VENUE)} for ${clock(p.TIME)}${p.SEATS ? `, seats ${p.SEATS}` : ''}.`;

    case 'MEETING':
      if (p.AVAILABLE === 'FALSE') {
        return ru ? 'Агент B не нашёл свободного слота в этом окне.' : 'Agent B found no open slot in that window.';
      }
      return ru
        ? `Агент B нашёл свободное время: ${clock(p.TIME)}${p.ROOM ? `, комната ${pretty(p.ROOM)}` : ''}.`
        : `Agent B found an available time: ${clock(p.TIME)}${p.ROOM ? `, room ${pretty(p.ROOM)}` : ''}.`;

    case 'WEATHER':
      return ru
        ? `Агент B сообщает: ${p.TEMP_C}°C, ${pretty(p.CONDITION).toLowerCase()}${p.WIND_KPH ? `, ветер ${p.WIND_KPH} км/ч` : ''}.`
        : `Agent B reports ${p.TEMP_C}°C, ${pretty(p.CONDITION).toLowerCase()}${p.WIND_KPH ? `, wind ${p.WIND_KPH} kph` : ''}.`;

    case 'TAXI':
      return ru
        ? `Агент B подал машину (${pretty(p.CAR)}), подача ${p.ETA_MIN} мин, цена ~${p.PRICE_KZT} ₸.`
        : `Agent B dispatched a ${pretty(p.CAR)}, arriving in ${p.ETA_MIN} min, about ${p.PRICE_KZT} KZT.`;

    case 'HOTEL_BOOKING':
      return ru
        ? `Агент B нашёл «${pretty(p.HOTEL)}»: номеров ${p.ROOMS}, примерно ${p.PRICE_KZT} ₸.`
        : `Agent B found ${pretty(p.HOTEL)}: ${p.ROOMS} room(s), about ${p.PRICE_KZT} KZT.`;

    default:
      return ru ? 'Агент B ответил.' : 'Agent B responded.';
  }
}

/**
 * A message for the human when nothing in the catalogue matched.
 * @param {string} humanText
 * @returns {string}
 */
export function unknownIntentReply(humanText) {
  const list = Object.values(INTENTS).map((i) => i.label).join(', ');
  return isCyrillic(humanText)
    ? `Не удалось распознать задачу. Этот агент умеет: ${list}.`
    : `No transmissible task recognised. This agent speaks: ${list}.`;
}
