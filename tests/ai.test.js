import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { extractJson, normalizeIntent, normalizeParams, normalizeValue, parseClock } from '../src/ai/normalize.js';
import * as fallback from '../src/ai/fallback.js';
import { encodeFrame } from '../src/protocol/encoder.js';
import { asInt, asToken, DATE, TIME } from '../src/protocol/schema.js';
import { resolveTask } from '../src/domain/world.js';
import { decodeFrame } from '../src/protocol/decoder.js';

describe('normalisation (the airlock between the model and the wire)', () => {
  it('coerces spelled-out numbers', () => {
    assert.equal(normalizeValue('PEOPLE', 'four', asInt(1, 50)), '4');
    assert.equal(normalizeValue('PEOPLE', 'пять', asInt(1, 50)), '5');
    assert.equal(normalizeValue('PEOPLE', 4, asInt(1, 50)), '4');
  });

  it('transliterates and uppercases place names', () => {
    assert.equal(normalizeValue('CITY', 'Алматы', asToken(24)), 'ALMATY');
    assert.equal(normalizeValue('CITY', 'New York', asToken(24)), 'NEW_YORK');
  });

  it('normalises clocks', () => {
    assert.equal(parseClock('7 PM'), '1900');
    assert.equal(parseClock('19:30'), '1930');
    assert.equal(parseClock('12 AM'), '0000');
    assert.equal(normalizeValue('TIME', '6 pm', TIME), '1800');
    assert.equal(normalizeValue('TIME', 'вечером', TIME), 'EVENING');
    assert.equal(normalizeValue('DATE', 'завтра', DATE), 'TOMORROW');
  });

  it('drops values that are still prose after every rescue attempt', () => {
    assert.equal(normalizeValue('CITY', 'Какая погода сегодня?', asToken(24)), null);
    assert.equal(normalizeValue('CITY', '???', asToken(24)), null);
    assert.equal(normalizeValue('CITY', '', asToken(24)), null);
  });

  it('drops keys the intent does not declare', () => {
    const { params, dropped } = normalizeParams('TASK', 'WEATHER', {
      city: 'Almaty', date: 'tomorrow', nonsense: 'value',
    });
    assert.deepEqual(params, { CITY: 'ALMATY', DATE: 'TOMORROW' });
    assert.equal(dropped.length, 1);
    assert.equal(dropped[0]?.key, 'NONSENSE');
  });

  it('only accepts intents the protocol knows', () => {
    assert.equal(normalizeIntent('restaurant_booking'), 'RESTAURANT_BOOKING');
    assert.equal(normalizeIntent('Restaurant Booking'), 'RESTAURANT_BOOKING');
    assert.equal(normalizeIntent('launch_missiles'), null);
  });

  it('extracts JSON that a model wrapped in prose or fences', () => {
    assert.deepEqual(extractJson('```json\n{"intent":"WEATHER"}\n```'), { intent: 'WEATHER' });
    assert.deepEqual(extractJson('Sure! {"a":{"b":1}} hope that helps'), { a: { b: 1 } });
    assert.equal(extractJson('no json here'), null);
  });

  it('produces params the encoder accepts, end to end', () => {
    const { params } = normalizeParams('TASK', 'RESTAURANT_BOOKING', {
      city: 'Алматы', people: 'four', date: 'tomorrow', time: '7 PM',
    });
    const { frame } = encodeFrame({ type: 'TASK', intent: 'RESTAURANT_BOOKING', params, id: '001' });
    assert.equal(frame, 'HL/0.1|TASK|RESTAURANT_BOOKING|CITY=ALMATY|DATE=TOMORROW|PEOPLE=4|TIME=1900|ID=001');
  });
});

describe('deterministic reasoner', () => {
  it('understands the demo scenarios', () => {
    const meeting = fallback.understand('Can you find a meeting time tomorrow after 6 PM?');
    assert.equal(meeting.intent, 'MEETING');
    assert.equal(meeting.params.DATE, 'TOMORROW');
    assert.equal(meeting.params.TIME_AFTER, '1800');

    const restaurant = fallback.understand('Find me a restaurant in Almaty for four people tomorrow evening.');
    assert.equal(restaurant.intent, 'RESTAURANT_BOOKING');
    assert.equal(restaurant.params.CITY, 'ALMATY');
    assert.equal(restaurant.params.PEOPLE, 4);
    assert.equal(restaurant.params.DATE, 'TOMORROW');

    const weather = fallback.understand('Какая погода в Алматы сегодня?');
    assert.equal(weather.intent, 'WEATHER');
    assert.equal(weather.params.CITY, 'ALMATY');
    assert.equal(weather.params.DATE, 'TODAY');
  });

  it('returns no intent for something outside the catalogue', () => {
    assert.equal(fallback.understand('write me a poem about the sea').intent, null);
  });

  it('speaks back in the language the human used', () => {
    const en = fallback.verbalize({ humanText: 'find a slot', intent: 'MEETING', params: { AVAILABLE: 'TRUE', TIME: '1930', ROOM: 'VEGA' } });
    assert.match(en, /19:30/);
    const ru = fallback.verbalize({ humanText: 'найди время', intent: 'MEETING', params: { AVAILABLE: 'TRUE', TIME: '1930' } });
    assert.match(ru, /Агент B/);
  });
});

describe('world model', () => {
  it('is deterministic for the same task', () => {
    const task = decodeFrame('HL/0.1|TASK|MEETING|DATE=TOMORROW|DURATION_MIN=30|TIME_AFTER=1800|ID=001');
    const first = resolveTask(task);
    const second = resolveTask(task);
    assert.deepEqual(first.params, second.params);
    assert.equal(first.params.AVAILABLE, 'TRUE');
  });

  it('proposes results every intent can encode', () => {
    const tasks = [
      'HL/0.1|TASK|RESTAURANT_BOOKING|CITY=ALMATY|DATE=TOMORROW|PEOPLE=4|TIME=EVENING|ID=001',
      'HL/0.1|TASK|MEETING|DATE=TOMORROW|TIME_AFTER=1800|ID=002',
      'HL/0.1|TASK|WEATHER|CITY=ALMATY|DATE=TODAY|ID=003',
      'HL/0.1|TASK|TAXI|CITY=ALMATY|FROM=CITY_CENTER|TO=AIRPORT|TIME=NOW|ID=004',
      'HL/0.1|TASK|HOTEL_BOOKING|CITY=ASTANA|DATE=TOMORROW|GUESTS=2|NIGHTS=3|ID=005',
    ];
    for (const raw of tasks) {
      const task = decodeFrame(raw);
      const world = resolveTask(task);
      const { frame } = encodeFrame({
        type: 'RESULT',
        intent: task.intent,
        params: world.params,
        id: '900',
        reply: task.id,
      });
      assert.equal(decodeFrame(frame).intent, task.intent);
    }
  });
});

describe('the demo buttons', () => {
  // These five sentences are what gets typed in front of an audience, so the
  // mapping from each one to its intent is a guarded contract. This suite
  // exists because "EAT" hides inside "wEAThER": substring keyword matching
  // silently routed the weather demo to the restaurant agent.
  const EXPECTED = {
    meeting: 'MEETING',
    restaurant: 'RESTAURANT_BOOKING',
    weather: 'WEATHER',
    taxi: 'TAXI',
    hotel: 'HOTEL_BOOKING',
  };

  it('each scenario resolves to its own intent and encodes cleanly', async () => {
    const { DEMO_SCENARIOS } = await import('../src/server/agent.js');
    assert.equal(DEMO_SCENARIOS.length, Object.keys(EXPECTED).length);

    for (const scenario of DEMO_SCENARIOS) {
      const expected = EXPECTED[/** @type {keyof typeof EXPECTED} */ (scenario.id)];
      assert.ok(expected, `unmapped scenario: ${scenario.id}`);

      const guess = fallback.understand(scenario.text);
      assert.equal(guess.intent, expected, `"${scenario.text}" should be ${expected}`);

      // And the understanding must survive the encoder, not just the matcher.
      const { params } = normalizeParams(
        'TASK',
        expected,
        /** @type {Record<string, unknown>} */ (guess.params),
      );
      const { frame } = encodeFrame({ type: 'TASK', intent: expected, params, id: '001' });
      assert.match(frame, new RegExp(`^HL/0\\.1\\|TASK\\|${expected}\\|`));
    }
  });
});
