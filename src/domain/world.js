/**
 * Agent B's world model.
 *
 * A small deterministic knowledge base — booking slots, a calendar, a weather
 * table, a taxi fleet, hotels. Agent B's AI reasons *about* this data, but the
 * data itself never changes between runs, which is what makes the demo safe to
 * put on a projector: the same task always yields the same result.
 *
 * Everything here is synthetic. No external service is contacted.
 */

/** @typedef {import('../protocol/validate.js').FrameParts} FrameParts */

/**
 * Deterministic hash → stable "randomness" without a random source.
 * @param {string} input
 * @returns {number} 0..2^32-1
 */
function hash(input) {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * @param {string} seed
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function pick(seed, min, max) {
  return min + (hash(seed) % (max - min + 1));
}

/**
 * @param {string} seed
 * @param {readonly string[]} list
 * @returns {string}
 */
function pickOne(seed, list) {
  return list[hash(seed) % list.length] ?? list[0] ?? '';
}

const VENUES = ['ARBAT_GRILL', 'ALASHA', 'DAREJANI', 'AUYL', 'RUMI', 'SINTOHO'];
const HOTELS = ['RIXOS_ALMATY', 'RITZ_CARLTON', 'KAZZHOL', 'DOSTYK', 'INTERCONTINENTAL'];
const CARS = ['HYUNDAI_ELANTRA', 'TOYOTA_CAMRY', 'KIA_K5', 'CHEVROLET_ONIX'];
const ROOMS = ['ORBIT_1', 'ORBIT_2', 'VEGA', 'ALTAIR', 'LYRA'];
const CONDITIONS = ['CLEAR', 'CLOUDY', 'RAIN', 'SNOW', 'WINDY', 'FOG'];

/** Time keywords → the hour the responder treats as the window start. */
const WINDOW_START = {
  NOW: 0, MORNING: 900, NOON: 1200, AFTERNOON: 1400, EVENING: 1900, NIGHT: 2100,
};

/**
 * @param {string | undefined} time
 * @returns {number | null} HHMM as a number
 */
function toHHMM(time) {
  if (!time) return null;
  if (time in WINDOW_START) {
    return WINDOW_START[/** @type {keyof typeof WINDOW_START} */ (time)];
  }
  if (/^\d{4}$/.test(time)) return Number(time);
  return null;
}

/** @param {number} hhmm @returns {string} */
function fmt(hhmm) {
  return String(Math.max(0, Math.min(2359, hhmm))).padStart(4, '0');
}

/**
 * Advance an HHMM value by whole half-hours without leaving the day.
 * @param {number} hhmm
 * @param {number} halfHours
 * @returns {number}
 */
function addHalfHours(hhmm, halfHours) {
  const total = Math.floor(hhmm / 100) * 60 + (hhmm % 100) + halfHours * 30;
  const clamped = Math.min(Math.max(total, 0), 23 * 60 + 30);
  return Math.floor(clamped / 60) * 100 + (clamped % 60);
}

/**
 * @typedef {object} WorldResult
 * @property {string} intent
 * @property {Record<string, string|number>} params  proposed RESULT parameters
 * @property {Record<string, string|number|boolean>} facts  what the backend knows
 */

/**
 * Resolve a decoded TASK against the world.
 *
 * Returns a plain structured object — never a frame. Turning this into a frame
 * is the encoder's job, and only the encoder's.
 *
 * @param {FrameParts} task
 * @returns {WorldResult}
 */
export function resolveTask(task) {
  const p = task.params;
  const seed = `${task.intent}|${Object.entries(p).sort().map(([k, v]) => `${k}=${v}`).join(',')}`;

  switch (task.intent) {
    case 'RESTAURANT_BOOKING': {
      const people = Number(p.PEOPLE ?? 2);
      const requested = toHHMM(p.TIME) || 1900;
      const time = fmt(addHalfHours(requested, pick(`${seed}:slot`, 0, 3)));
      const oversized = people > 12;
      return {
        intent: task.intent,
        params: {
          STATUS: oversized ? 'PARTIAL' : 'AVAILABLE',
          TIME: time,
          VENUE: pickOne(`${seed}:venue`, VENUES),
          SEATS: oversized ? 12 : people,
          TABLE: `T${pick(`${seed}:table`, 1, 24)}`,
        },
        facts: { requestedPeople: people, seatedPeople: oversized ? 12 : people, offeredTime: time },
      };
    }

    case 'MEETING': {
      const after = toHHMM(p.TIME_AFTER) ?? 900;
      const before = toHHMM(p.TIME_BEFORE) ?? 2200;
      const duration = Number(p.DURATION_MIN ?? 30);
      const proposed = addHalfHours(after, 1 + pick(`${seed}:slot`, 0, 2));
      const fits = proposed <= before;
      return {
        intent: task.intent,
        params: fits
          ? {
            AVAILABLE: 'TRUE',
            TIME: fmt(proposed),
            DURATION_MIN: duration,
            ROOM: pickOne(`${seed}:room`, ROOMS),
          }
          : { AVAILABLE: 'FALSE' },
        facts: { proposedTime: fmt(proposed), window: `${fmt(after)}-${fmt(before)}`, fits },
      };
    }

    case 'WEATHER': {
      const city = String(p.CITY ?? 'UNKNOWN');
      return {
        intent: task.intent,
        params: {
          TEMP_C: pick(`${seed}:temp`, -8, 33) - 4,
          CONDITION: pickOne(`${seed}:cond`, CONDITIONS),
          WIND_KPH: pick(`${seed}:wind`, 0, 42),
          HUMIDITY: pick(`${seed}:hum`, 20, 95),
        },
        facts: { city },
      };
    }

    case 'TAXI': {
      return {
        intent: task.intent,
        params: {
          STATUS: 'AVAILABLE',
          ETA_MIN: pick(`${seed}:eta`, 2, 14),
          PRICE_KZT: pick(`${seed}:price`, 900, 4200),
          CAR: pickOne(`${seed}:car`, CARS),
        },
        facts: { from: String(p.FROM ?? ''), to: String(p.TO ?? '') },
      };
    }

    case 'HOTEL_BOOKING': {
      const guests = Number(p.GUESTS ?? 1);
      const nights = Number(p.NIGHTS ?? 1);
      const rooms = Math.ceil(guests / 2);
      return {
        intent: task.intent,
        params: {
          STATUS: rooms > 6 ? 'PARTIAL' : 'AVAILABLE',
          HOTEL: pickOne(`${seed}:hotel`, HOTELS),
          PRICE_KZT: pick(`${seed}:price`, 18000, 90000) * nights,
          ROOMS: Math.min(rooms, 6),
        },
        facts: { guests, nights, rooms },
      };
    }

    default:
      throw new Error(`no world model for intent ${task.intent}`);
  }
}
