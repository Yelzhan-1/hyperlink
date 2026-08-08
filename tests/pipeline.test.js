/**
 * End-to-end: a real HTTP+WebSocket server, two real WebSocket clients acting
 * as the two laptops, and a stand-in Ollama daemon so the *actual* model code
 * path is exercised rather than mocked away.
 */

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, describe, it } from 'node:test';
import { WebSocket } from 'ws';

import { createApp } from '../src/server/index.js';

/** Minimal stand-in for a local Ollama daemon. */
function startFakeOllama() {
  /** @type {{system: string, user: string}[]} */
  const calls = [];

  const server = createServer((req, res) => {
    if (req.url === '/api/tags') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ models: [{ name: 'test-model' }] }));
      return;
    }
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const payload = JSON.parse(body);
      const system = payload.messages[0].content;
      const user = payload.messages[1].content;
      calls.push({ system, user });

      let content;
      if (system.includes('Agent A') && system.includes('structured intent object')) {
        // Deliberately sloppy, the way a real model answers: lowercase keys,
        // a spelled-out number, a stray field. The airlock has to clean it.
        content = JSON.stringify({
          intent: 'meeting',
          params: { date: 'tomorrow', time_after: '6 PM', duration_min: 'thirty', mood: 'happy' },
          confidence: 0.91,
        });
      } else if (system.includes('Agent B')) {
        content = JSON.stringify({ params: { AVAILABLE: 'TRUE', TIME: '1930', ROOM: 'VEGA' } });
      } else {
        content = 'Agent B found an available time: 19:30.';
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: { content } }));
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({ server, calls, url: `http://127.0.0.1:${port}` });
    });
  });
}

/** Collects every event a laptop receives. */
class Client {
  /** @param {number} port @param {'A'|'B'} agent */
  constructor(port, agent) {
    this.agent = agent;
    /** @type {any[]} */
    this.events = [];
    this.socket = new WebSocket(`ws://127.0.0.1:${port}/ws?agent=${agent}`);
    this.socket.on('message', (data) => this.events.push(JSON.parse(data.toString())));
  }

  ready() {
    return new Promise((resolve, reject) => {
      this.socket.once('open', resolve);
      this.socket.once('error', reject);
    });
  }

  /** @param {object} message */
  send(message) {
    this.socket.send(JSON.stringify(message));
  }

  /** @param {string} type @returns {any[]} */
  ofType(type) {
    return this.events.filter((e) => e.t === type);
  }

  /**
   * @param {(e: any) => boolean} predicate
   * @param {number} [timeoutMs]
   * @returns {Promise<any>}
   */
  waitFor(predicate, timeoutMs = 8000) {
    const existing = this.events.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.socket.off('message', onMessage);
        reject(new Error(`timed out waiting on ${this.agent}`));
      }, timeoutMs);
      /** @param {any} data */
      const onMessage = (data) => {
        const event = JSON.parse(data.toString());
        if (!predicate(event)) return;
        clearTimeout(timer);
        this.socket.off('message', onMessage);
        resolve(event);
      };
      this.socket.on('message', onMessage);
    });
  }

  close() {
    this.socket.close();
  }
}

describe('two laptops, one link', () => {
  /** @type {any} */
  let ollama;
  /** @type {any} */
  let app;
  /** @type {number} */
  let port;
  /** @type {Client} */
  let laptopA;
  /** @type {Client} */
  let laptopB;

  before(async () => {
    ollama = await startFakeOllama();
    app = createApp({
      stageDelayMs: 0,
      ollamaBaseUrl: ollama.url,
      ollamaModel: 'test-model',
      provider: 'ollama',
      allowFallback: true,
    });
    await new Promise((resolve) => app.server.listen(0, '127.0.0.1', () => resolve(undefined)));
    const address = app.server.address();
    port = typeof address === 'object' && address ? address.port : 0;

    const online = await app.ai.probe();
    assert.equal(online, true, 'the AI backend should be reachable');
    assert.equal(app.ai.label, 'OLLAMA:test-model');

    laptopA = new Client(port, 'A');
    laptopB = new Client(port, 'B');
    await Promise.all([laptopA.ready(), laptopB.ready()]);
  });

  after(() => {
    laptopA?.close();
    laptopB?.close();
    app?.wss.close();
    app?.server.close();
    ollama?.server.close();
  });

  it('sees both laptops as present', async () => {
    const presence = await laptopA.waitFor((e) => e.t === 'presence' && e.a && e.b);
    assert.equal(presence.a, true);
    assert.equal(presence.b, true);
  });

  it('carries a human request across the link and answers in human language', async () => {
    const humanText = 'Can you find a meeting time tomorrow after 6 PM?';
    laptopA.send({ t: 'human', text: humanText });

    const reply = await laptopA.waitFor((e) => e.t === 'human' && e.role === 'out');
    assert.match(reply.text, /19:30/);

    // A to B carried a TASK ...
    const task = laptopA.ofType('frame').find((f) => f.dir === 'A>B' && f.decoded.type === 'TASK');
    assert.ok(task, 'expected a TASK frame from A to B');
    assert.equal(task.decoded.intent, 'MEETING');
    assert.equal(task.decoded.params.DATE, 'TOMORROW');
    assert.equal(task.decoded.params.TIME_AFTER, '1800');
    // "thirty" was coerced, "mood" was not in the contract and was dropped.
    assert.equal(task.decoded.params.DURATION_MIN, '30');
    assert.equal(task.decoded.params.MOOD, undefined);

    // ... and B answered with a RESULT that references it.
    const result = laptopA.ofType('frame').find((f) => f.dir === 'B>A' && f.decoded.type === 'RESULT');
    assert.ok(result, 'expected a RESULT frame from B to A');
    assert.equal(result.decoded.intent, 'MEETING');
    assert.equal(result.decoded.reply, task.decoded.id);
    assert.equal(result.decoded.params.TIME, '1930');
  });

  it('never lets the human sentence reach Agent B', () => {
    // The welcome payload legitimately carries the demo prompt catalogue — the
    // buttons on B's own screen. Everything *after* the handshake is the
    // conversation, and none of it may contain a word the human typed.
    const conversation = JSON.stringify(laptopB.events.filter((e) => e.t !== 'welcome'));
    assert.equal(laptopB.ofType('human').length, 0, 'Agent B must receive no human-language events');
    assert.ok(!conversation.includes('Can you find a meeting time'));
    assert.ok(!conversation.includes('19:30'), 'B should not see the humanised answer either');

    // Everything that crossed the wire was a frame, and no frame contains prose.
    for (const entry of app.hub.wireLog) {
      assert.match(entry.frame, /^HL\/0\.1\|/);
      assert.ok(!/[a-z]/.test(entry.frame.split('|').slice(3).join('|')));
    }
  });

  it('shows Agent B the packet, so both laptops watch the same conversation', () => {
    const seenByB = laptopB.ofType('frame');
    assert.ok(seenByB.some((f) => f.dir === 'A>B' && f.decoded.type === 'TASK'));
    assert.ok(seenByB.some((f) => f.dir === 'B>A' && f.decoded.type === 'RESULT'));
  });

  it('walks through the visible pipeline stages in order', () => {
    const stages = laptopA.ofType('stage').map((s) => s.stage);
    for (const expected of [
      'INPUT_RECEIVED', 'UNDERSTANDING', 'INTENT_EXTRACTED', 'SWITCHING',
      'ENCODING', 'VALIDATED', 'TRANSMITTING', 'RECEIVED', 'PROCESSING',
      'TRANSMITTING_BACK', 'RESULT_RECEIVED', 'TRANSLATING', 'DELIVERED',
    ]) {
      assert.ok(stages.includes(expected), `missing stage ${expected}`);
    }
    assert.ok(
      stages.indexOf('SWITCHING') < stages.indexOf('TRANSMITTING'),
      'the switch to HYPERLINK must precede transmission',
    );
  });

  it('used the real model path for every reasoning step', () => {
    /** @type {string[]} */
    const systems = ollama.calls.map((/** @type {any} */ c) => c.system);
    assert.ok(systems.some((s) => s.includes('reasoning core of HYPERLINK Agent A')));
    assert.ok(systems.some((s) => s.includes('reasoning core of HYPERLINK Agent B')));
    assert.ok(systems.some((s) => s.includes('voice of HYPERLINK Agent A')));
  });

  it('rejects an injected frame that smuggles a sentence, and transmits nothing', async () => {
    const before = app.hub.wireLog.length;
    laptopA.send({ t: 'inject', frame: 'HL/0.1|TASK|WEATHER|CITY=Какая погода сегодня?|DATE=TODAY|ID=800' });

    const reject = await laptopA.waitFor((e) => e.t === 'reject' && e.code === 'E_NL_DETECTED');
    assert.match(reject.message, /natural language/i);
    assert.equal(app.hub.wireLog.length, before, 'nothing may reach the wire');
  });

  it('accepts a well-formed injected frame', async () => {
    laptopA.send({ t: 'inject', frame: 'HL/0.1|TASK|WEATHER|CITY=ALMATY|DATE=TODAY|ID=801' });
    const frame = await laptopA.waitFor(
      (e) => e.t === 'frame' && e.decoded.type === 'RESULT' && e.decoded.reply === '801',
    );
    assert.equal(frame.decoded.intent, 'WEATHER');
    assert.ok('TEMP_C' in frame.decoded.params);
  });
});

describe('no AI daemon on the network', () => {
  it('still completes the round trip on the deterministic reasoner', async () => {
    const app = createApp({
      stageDelayMs: 0,
      // Nothing is listening here — this is the "presenter's Wi-Fi" case.
      ollamaBaseUrl: 'http://127.0.0.1:1',
      ollamaModel: 'absent-model',
      provider: 'ollama',
      allowFallback: true,
    });
    await new Promise((resolve) => app.server.listen(0, '127.0.0.1', () => resolve(undefined)));
    const address = app.server.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    assert.equal(await app.ai.probe(), false);
    assert.equal(app.ai.label, 'FALLBACK:DETERMINISTIC');

    const laptopA = new Client(port, 'A');
    const laptopB = new Client(port, 'B');
    await Promise.all([laptopA.ready(), laptopB.ready()]);

    laptopA.send({ t: 'human', text: 'Find me a restaurant in Almaty for four people tomorrow evening.' });
    const reply = await laptopA.waitFor((e) => e.t === 'human' && e.role === 'out');
    assert.match(reply.text, /Agent B/);

    const task = laptopA.ofType('frame').find((f) => f.dir === 'A>B' && f.decoded.type === 'TASK');
    assert.equal(task.decoded.intent, 'RESTAURANT_BOOKING');
    assert.equal(task.decoded.params.CITY, 'ALMATY');
    assert.equal(task.decoded.params.PEOPLE, '4');
    assert.equal(laptopB.ofType('human').length, 0);

    laptopA.close();
    laptopB.close();
    app.wss.close();
    app.server.close();
  });
});
