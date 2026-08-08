import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Hub } from '../src/transport/hub.js';
import { parseClientMessage } from '../src/transport/envelope.js';
import { ProtocolError } from '../src/protocol/errors.js';

/** A socket that just records what it was sent. */
function fakeSocket() {
  /** @type {any[]} */
  const received = [];
  return {
    readyState: 1,
    received,
    /** @param {string} data */
    send(data) { received.push(JSON.parse(data)); },
    /** @param {string} type @returns {any[]} */
    ofType(type) { return received.filter((m) => m.t === type); },
  };
}

const TASK = 'HL/0.1|TASK|WEATHER|CITY=ALMATY|DATE=TODAY|ID=001';

describe('hub', () => {
  it('tracks which laptop is which agent', () => {
    const hub = new Hub();
    const a = fakeSocket();
    const b = fakeSocket();
    assert.deepEqual(hub.presence(), { a: false, b: false });
    hub.attach(a, 'A');
    assert.deepEqual(hub.presence(), { a: true, b: false });
    hub.attach(b, 'B');
    assert.deepEqual(hub.presence(), { a: true, b: true });
    hub.detach(a);
    assert.deepEqual(hub.presence(), { a: false, b: true });
  });

  it('delivers a valid frame to the peer runtime', () => {
    const hub = new Hub();
    /** @type {string[]} */
    const delivered = [];
    hub.onFrame('B', (frame) => delivered.push(frame));
    const decoded = hub.transmit('A', 'B', TASK);
    assert.deepEqual(delivered, [TASK]);
    assert.equal(decoded.intent, 'WEATHER');
  });

  it('refuses to carry anything that is not a valid frame', () => {
    const hub = new Hub();
    hub.onFrame('B', () => {});
    for (const payload of [
      'find me a restaurant in almaty',
      'HL/0.1|TASK|WEATHER|CITY=Какая погода сегодня?|DATE=TODAY|ID=001',
      'HL/0.1|TASK|UNKNOWN_INTENT|ID=001',
      '',
    ]) {
      assert.throws(() => hub.transmit('A', 'B', payload), ProtocolError, `should refuse: ${payload}`);
    }
  });

  it('never delivers human language to the peer agent', () => {
    const hub = new Hub();
    const a = fakeSocket();
    const b = fakeSocket();
    hub.attach(a, 'A');
    hub.attach(b, 'B');

    hub.human('A', 'in', 'Find me a restaurant in Almaty for four people');
    hub.human('A', 'out', 'Agent B booked a table');

    assert.equal(a.ofType('human').length, 2);
    assert.equal(b.ofType('human').length, 0);

    const everythingBSaw = JSON.stringify(b.received);
    assert.ok(!everythingBSaw.includes('restaurant in Almaty'));
  });

  it('shows the packet to both laptops, because a packet has nothing to leak', () => {
    const hub = new Hub();
    const a = fakeSocket();
    const b = fakeSocket();
    hub.attach(a, 'A');
    hub.attach(b, 'B');
    hub.onFrame('B', () => {});

    hub.transmit('A', 'B', TASK);
    assert.equal(a.ofType('frame').length, 1);
    assert.equal(b.ofType('frame').length, 1);
    assert.equal(b.ofType('frame')[0].frame, TASK);
  });
});

describe('client envelope parsing', () => {
  it('accepts only known message types', () => {
    assert.deepEqual(parseClientMessage('{"t":"human","text":"hi"}'), { t: 'human', text: 'hi' });
    assert.equal(parseClientMessage('{"t":"drop_tables"}'), null);
    assert.equal(parseClientMessage('not json'), null);
    assert.equal(parseClientMessage(JSON.stringify({ t: 'human', text: 'x'.repeat(9000) })), null);
  });

  it('truncates oversized text instead of trusting it', () => {
    const msg = parseClientMessage(JSON.stringify({ t: 'human', text: 'y'.repeat(4000) }));
    assert.equal(msg?.text?.length, 2000);
  });
});
