import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { encodeFrame } from '../src/protocol/encoder.js';
import { decodeFrame, isValidFrame, looksLikeFrame } from '../src/protocol/decoder.js';
import { ProtocolError } from '../src/protocol/errors.js';
import { IdSequence } from '../src/protocol/ids.js';
import { HL_VERSION } from '../src/protocol/schema.js';

/**
 * @param {() => unknown} fn
 * @returns {string} the ProtocolError code
 */
function codeOf(fn) {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof ProtocolError, `expected ProtocolError, got ${String(err)}`);
    return err.code;
  }
  assert.fail('expected the call to throw');
}

describe('encoder', () => {
  it('builds the canonical frame from the specification', () => {
    const { frame } = encodeFrame({
      type: 'TASK',
      intent: 'RESTAURANT_BOOKING',
      params: { CITY: 'ALMATY', PEOPLE: 4, DATE: 'TOMORROW', TIME: 'EVENING' },
      id: '001',
    });
    assert.equal(
      frame,
      'HL/0.1|TASK|RESTAURANT_BOOKING|CITY=ALMATY|DATE=TOMORROW|PEOPLE=4|TIME=EVENING|ID=001',
    );
  });

  it('carries REPLY on results', () => {
    const { frame } = encodeFrame({
      type: 'RESULT',
      intent: 'MEETING',
      params: { AVAILABLE: 'TRUE', TIME: '1930' },
      id: '002',
      reply: '001',
    });
    assert.equal(frame, 'HL/0.1|RESULT|MEETING|AVAILABLE=TRUE|TIME=1930|ID=002|REPLY=001');
  });

  it('is deterministic regardless of key insertion order', () => {
    const a = encodeFrame({ type: 'TASK', intent: 'WEATHER', params: { CITY: 'ALMATY', DATE: 'TODAY' }, id: '007' });
    const b = encodeFrame({ type: 'TASK', intent: 'WEATHER', params: { DATE: 'TODAY', CITY: 'ALMATY' }, id: '007' });
    assert.equal(a.frame, b.frame);
  });

  it('refuses a natural-language sentence inside a parameter', () => {
    assert.equal(
      codeOf(() => encodeFrame({
        type: 'TASK',
        intent: 'WEATHER',
        params: { CITY: 'Какая погода сегодня?', DATE: 'TODAY' },
        id: '003',
      })),
      'E_NL_DETECTED',
    );
  });

  it('refuses prose in any script, including plain English', () => {
    assert.equal(
      codeOf(() => encodeFrame({
        type: 'TASK',
        intent: 'WEATHER',
        params: { CITY: 'what is the weather', DATE: 'TODAY' },
        id: '004',
      })),
      'E_NL_DETECTED',
    );
  });

  it('refuses unknown intents, unknown keys and missing required keys', () => {
    assert.equal(codeOf(() => encodeFrame({ type: 'TASK', intent: 'LAUNCH_MISSILES', params: {}, id: '005' })), 'E_INTENT');
    assert.equal(
      codeOf(() => encodeFrame({ type: 'TASK', intent: 'WEATHER', params: { CITY: 'ALMATY', DATE: 'TODAY', COLOUR: 'RED' }, id: '006' })),
      'E_PARAM_KEY',
    );
    assert.equal(codeOf(() => encodeFrame({ type: 'TASK', intent: 'WEATHER', params: { CITY: 'ALMATY' }, id: '007' })), 'E_REQUIRED');
  });

  it('enforces value types', () => {
    assert.equal(
      codeOf(() => encodeFrame({ type: 'TASK', intent: 'RESTAURANT_BOOKING', params: { CITY: 'ALMATY', PEOPLE: 999, DATE: 'TODAY' }, id: '008' })),
      'E_PARAM_VALUE',
    );
    assert.equal(
      codeOf(() => encodeFrame({ type: 'TASK', intent: 'RESTAURANT_BOOKING', params: { CITY: 'ALMATY', PEOPLE: 4, DATE: 'SOMEDAY' }, id: '009' })),
      'E_PARAM_VALUE',
    );
    assert.equal(
      codeOf(() => encodeFrame({ type: 'TASK', intent: 'RESTAURANT_BOOKING', params: { CITY: 'ALMATY', PEOPLE: 4, DATE: 'TODAY', TIME: '2599' }, id: '010' })),
      'E_PARAM_VALUE',
    );
  });

  it('rejects malformed ids and reserved parameter names', () => {
    assert.equal(codeOf(() => encodeFrame({ type: 'TASK', intent: 'WEATHER', params: { CITY: 'ALMATY', DATE: 'TODAY' }, id: 'x' })), 'E_ID');
    assert.equal(
      codeOf(() => encodeFrame({ type: 'TASK', intent: 'WEATHER', params: { CITY: 'ALMATY', DATE: 'TODAY', ID: '999' }, id: '011' })),
      'E_PARAM_KEY',
    );
  });
});

describe('decoder', () => {
  it('round-trips every frame the encoder produces', () => {
    const { frame } = encodeFrame({
      type: 'TASK',
      intent: 'TAXI',
      params: { CITY: 'ALMATY', FROM: 'CITY_CENTER', TO: 'AIRPORT', TIME: 'NOW' },
      id: '012',
    });
    const decoded = decodeFrame(frame);
    assert.equal(decoded.version, HL_VERSION);
    assert.equal(decoded.type, 'TASK');
    assert.equal(decoded.intent, 'TAXI');
    assert.equal(decoded.params.TO, 'AIRPORT');
    assert.equal(decoded.id, '012');
    assert.equal(encodeFrame({ type: 'TASK', intent: 'TAXI', params: decoded.params, id: decoded.id }).frame, frame);
  });

  it('rejects a wrong version, junk, and hand-written prose', () => {
    assert.equal(codeOf(() => decodeFrame('HL/9.9|TASK|WEATHER|CITY=ALMATY|DATE=TODAY|ID=001')), 'E_VERSION');
    assert.equal(codeOf(() => decodeFrame('hello agent b, what is the weather?')), 'E_SYNTAX');
    assert.equal(codeOf(() => decodeFrame('HL/0.1|TASK|WEATHER|CITY=ALMATY|DATE=TODAY')), 'E_ID');
    assert.equal(codeOf(() => decodeFrame('HL/0.1|TASK|WEATHER|CITY=ALMATY|CITY=ASTANA|DATE=TODAY|ID=001')), 'E_DUP_KEY');
    assert.equal(codeOf(() => decodeFrame(' HL/0.1|TASK|WEATHER|CITY=ALMATY|DATE=TODAY|ID=001')), 'E_SYNTAX');
  });

  it('rejects a frame with a smuggled sentence', () => {
    assert.equal(
      codeOf(() => decodeFrame('HL/0.1|TASK|WEATHER|CITY=Какая погода сегодня?|DATE=TODAY|ID=001')),
      'E_NL_DETECTED',
    );
  });

  it('reports validity without throwing', () => {
    assert.equal(isValidFrame('HL/0.1|TASK|WEATHER|CITY=ALMATY|DATE=TODAY|ID=001'), true);
    assert.equal(isValidFrame('nope'), false);
    assert.equal(looksLikeFrame('HL/0.1|TASK|X'), true);
    assert.equal(looksLikeFrame('hello'), false);
  });
});

describe('ids', () => {
  it('produces zero-padded, monotonic identifiers', () => {
    const ids = new IdSequence(1);
    assert.equal(ids.next(), '001');
    assert.equal(ids.next(), '002');
    ids.reset(99);
    assert.equal(ids.next(), '099');
  });
});
