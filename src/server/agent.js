/**
 * Agent runtime.
 *
 * One instance per side of the link. Agent A faces a human; Agent B faces only
 * the protocol. The asymmetry is structural, not a policy: handleHuman() exists
 * on A's side of the conversation, handleFrame() is the ONLY entry point B has,
 * and it takes a frame — there is no method anywhere that hands B a sentence.
 *
 *   human text ─▶ [A] understand ─▶ intent JSON ─▶ encoder ─▶ validation ─▶ frame
 *                                                                            │
 *                                                              HYPERLINK ────┘
 *                                                                            ▼
 *   human text ◀─ [A] verbalize ◀─ result JSON ◀── decoder ◀── frame ◀── [B] resolve
 */

import { encodeFrame } from '../protocol/encoder.js';
import { ProtocolError, isProtocolError } from '../protocol/errors.js';
import { decodeFrame } from '../protocol/decoder.js';
import { knownIntents } from '../protocol/schema.js';
import { resolveTask } from '../domain/world.js';
import { fallback } from '../ai/index.js';
import { rejectEvent, stageEvent } from '../transport/envelope.js';

/** @typedef {import('../transport/envelope.js').AgentId} AgentId */
/** @typedef {import('../transport/envelope.js').StageKey} StageKey */
/** @typedef {import('../transport/hub.js').Hub} Hub */
/** @typedef {import('../ai/index.js').AiCore} AiCore */
/** @typedef {import('../protocol/decoder.js').DecodedFrame} DecodedFrame */
/** @typedef {import('../protocol/ids.js').IdSequence} IdSequence */

/** @param {number} ms @returns {Promise<void>} */
const sleep = (ms) => new Promise((done) => { setTimeout(done, ms); });

/**
 * Canned openers for the demo. They are ordinary human sentences fed through
 * the ordinary pipeline — nothing about the run is pre-recorded.
 */
export const DEMO_SCENARIOS = [
  { id: 'meeting', label: 'MEETING', text: 'Can you find a meeting time tomorrow after 6 PM?' },
  { id: 'restaurant', label: 'RESTAURANT', text: 'Find me a restaurant in Almaty for four people tomorrow evening.' },
  { id: 'weather', label: 'WEATHER', text: "What's the weather in Almaty today?" },
  { id: 'taxi', label: 'TAXI', text: 'I need a taxi to the airport in Almaty now.' },
  { id: 'hotel', label: 'HOTEL', text: 'Book a hotel in Astana for 2 guests tomorrow, 3 nights.' },
];

export class AgentRuntime {
  /**
   * @param {object} deps
   * @param {AgentId} deps.id
   * @param {AgentId} deps.peer
   * @param {Hub} deps.hub
   * @param {AiCore} deps.ai
   * @param {IdSequence} deps.ids
   * @param {number} deps.stageDelayMs
   */
  constructor({ id, peer, hub, ai, ids, stageDelayMs }) {
    /** @type {AgentId} */
    this.id = id;
    /** @type {AgentId} */
    this.peer = peer;
    this.hub = hub;
    this.ai = ai;
    this.ids = ids;
    /** @type {number} */
    this.stageDelayMs = stageDelayMs;
    /** @type {boolean} true once the peer has proven it speaks HYPERLINK */
    this.peerIsHyperlink = false;
    /** @type {Map<string, {humanText: string}>} outstanding tasks by message id */
    this.pending = new Map();
    /** @type {boolean} */
    this.busy = false;
  }

  /**
   * @param {StageKey} stage
   * @param {string} [note]
   * @param {boolean} [dwell]
   */
  async stage(stage, note = '', dwell = true) {
    this.hub.broadcast(stageEvent(this.id, stage, note));
    if (dwell && this.stageDelayMs > 0) await sleep(this.stageDelayMs);
  }

  // ── Agent A: the human-facing side ────────────────────────────────────────

  /**
   * A human said something. This is the only entry point that accepts prose,
   * and it belongs to the agent the human is sitting in front of.
   * @param {string} humanText
   */
  async handleHuman(humanText) {
    const text = String(humanText ?? '').trim();
    if (text === '') return;
    if (this.busy) {
      this.hub.human(this.id, 'out', 'One transmission at a time — still working on the last one.');
      return;
    }
    this.busy = true;
    try {
      this.hub.human(this.id, 'in', text);
      await this.stage('INPUT_RECEIVED', `${text.length} chars of natural language`);
      await this.stage('UNDERSTANDING', this.ai.label);

      const understanding = await this.ai.understand(text);

      if (!understanding.intent) {
        await this.stage('REJECTED', 'no transmissible intent', false);
        this.hub.broadcast(rejectEvent(this.id, 'E_INTENT', 'no intent matched the catalogue', {
          known: knownIntents(),
        }));
        this.hub.human(this.id, 'out', fallback.unknownIntentReply(text));
        return;
      }

      await this.stage(
        'INTENT_EXTRACTED',
        `${understanding.intent} · ${Object.keys(understanding.params).length} params · ${understanding.source === 'model' ? understanding.engine : 'DETERMINISTIC'} · conf ${understanding.confidence}`,
      );

      await this.ensureHyperlinkPeer();
      await this.stage('SWITCHING', `peer ${this.peer} is HYPERLINK-compatible — natural language stops here`);

      const id = this.ids.next();
      let frame;
      try {
        await this.stage('ENCODING', `TASK ${understanding.intent}`, false);
        ({ frame } = encodeFrame({
          type: 'TASK',
          intent: understanding.intent,
          params: understanding.params,
          id,
        }));
      } catch (err) {
        await this.rejectLocally(err, text);
        return;
      }

      await this.stage('VALIDATED', `${frame.length} bytes`);
      this.pending.set(id, { humanText: text });

      await this.stage('TRANSMITTING', `${this.id} ▸ ${this.peer}`, false);
      this.hub.transmit(this.id, this.peer, frame);
    } catch (err) {
      await this.failLoudly(err);
    } finally {
      this.busy = false;
    }
  }

  /**
   * A human typed a raw frame into the protocol console. Same encoder, same
   * validator — this is how you watch the security boundary do its job.
   * @param {string} raw
   */
  async injectFrame(raw) {
    try {
      const decoded = decodeFrame(raw.trim());
      if (decoded.type !== 'TASK') {
        throw new ProtocolError('E_TYPE', 'only TASK frames may be injected from the console');
      }
      this.pending.set(decoded.id, { humanText: `[manual frame] ${decoded.intent}` });
      await this.stage('VALIDATED', `manual frame accepted · ${decoded.intent}`);
      await this.stage('TRANSMITTING', `${this.id} ▸ ${this.peer}`, false);
      this.hub.transmit(this.id, this.peer, decoded.raw);
    } catch (err) {
      await this.rejectLocally(err, raw);
    }
  }

  /**
   * Capability handshake. Before any task crosses the link, the agents prove to
   * each other that they speak HYPERLINK — which is what licenses A to drop
   * natural language entirely.
   */
  async ensureHyperlinkPeer() {
    if (this.peerIsHyperlink) return;
    const { frame } = encodeFrame({
      type: 'HELLO',
      intent: 'CAPABILITY',
      params: { AGENT: this.id, ROLE: 'ORIGIN', INTENTS: knownIntents().length },
      id: this.ids.next(),
    });
    this.hub.transmit(this.id, this.peer, frame);
    this.peerIsHyperlink = true;
    await sleep(Math.min(this.stageDelayMs, 200));
  }

  // ── Agent B: the protocol-only side ───────────────────────────────────────

  /**
   * The ONLY way anything reaches this agent. Takes a frame, never a sentence.
   * @param {string} frame
   * @param {DecodedFrame} decoded
   */
  async handleFrame(frame, decoded) {
    try {
      switch (decoded.type) {
        case 'HELLO':
          await this.onHello(decoded);
          return;
        case 'TASK':
          await this.onTask(decoded);
          return;
        case 'RESULT':
          await this.onResult(decoded);
          return;
        case 'ERROR':
          await this.onError(decoded);
          return;
        default:
          return;
      }
    } catch (err) {
      await this.failLoudly(err);
    }
  }

  /** @param {DecodedFrame} decoded */
  async onHello(decoded) {
    this.peerIsHyperlink = true;
    await this.stage('RECEIVED', `HELLO from ${decoded.params.AGENT} · capability confirmed`, false);
    if (decoded.params.ROLE !== 'ORIGIN') return;
    const { frame } = encodeFrame({
      type: 'HELLO',
      intent: 'CAPABILITY',
      params: { AGENT: this.id, ROLE: 'RESPONDER', INTENTS: knownIntents().length },
      id: this.ids.next(),
    });
    this.hub.transmit(this.id, this.peer, frame);
  }

  /** @param {DecodedFrame} decoded */
  async onTask(decoded) {
    await this.stage('RECEIVED', `TASK ${decoded.intent} · ID=${decoded.id}`);
    await this.stage('DECODING', `${Object.keys(decoded.params).length} parameters · zero natural language`);
    await this.stage('PROCESSING', this.ai.label);

    try {
      const world = resolveTask(decoded);
      const resolved = await this.ai.resolve(decoded, world);

      await this.stage('ENCODING_RESULT', `RESULT ${decoded.intent}`, false);
      const { frame } = encodeFrame({
        type: 'RESULT',
        intent: decoded.intent,
        params: resolved.params,
        id: this.ids.next(),
        reply: decoded.id,
      });
      await this.stage('VALIDATED', `${frame.length} bytes`);
      await this.stage('TRANSMITTING_BACK', `${this.id} ▸ ${this.peer}`, false);
      this.hub.transmit(this.id, this.peer, frame);
    } catch (err) {
      await this.sendErrorFrame(err, decoded.id, decoded.intent);
    }
  }

  /** @param {DecodedFrame} decoded */
  async onResult(decoded) {
    await this.stage('RESULT_RECEIVED', `RESULT ${decoded.intent} · REPLY=${decoded.reply ?? '—'}`);
    await this.stage('DECODING', `${Object.keys(decoded.params).length} parameters`);

    const pending = decoded.reply ? this.pending.get(decoded.reply) : undefined;
    if (decoded.reply) this.pending.delete(decoded.reply);

    await this.stage('TRANSLATING', this.ai.label);
    const spoken = await this.ai.verbalize({
      humanText: pending?.humanText ?? '',
      intent: decoded.intent,
      params: decoded.params,
    });

    this.hub.human(this.id, 'out', spoken.text);
    await this.stage('DELIVERED', `via ${spoken.source === 'model' ? this.ai.label : 'DETERMINISTIC'}`, false);
  }

  /** @param {DecodedFrame} decoded */
  async onError(decoded) {
    await this.stage('REJECTED', `peer returned ${decoded.params.CODE}`, false);
    this.hub.broadcast(rejectEvent(this.id, String(decoded.params.CODE), 'peer rejected the task', {
      at: decoded.params.AT,
    }));
    if (decoded.reply) this.pending.delete(decoded.reply);
    this.hub.human(this.id, 'out', 'The peer agent could not complete that task.');
  }

  // ── Failure paths ─────────────────────────────────────────────────────────

  /**
   * Local validation refused to build a frame. Nothing is transmitted — that is
   * the entire point.
   * @param {unknown} err
   * @param {string} humanText
   */
  async rejectLocally(err, humanText) {
    const code = isProtocolError(err) ? err.code : 'E_SYNTAX';
    const message = err instanceof Error ? err.message : String(err);
    await this.stage('REJECTED', `${code} · nothing transmitted`, false);
    this.hub.broadcast(rejectEvent(this.id, code, message, isProtocolError(err) ? err.detail : {}));
    this.hub.human(
      this.id,
      'out',
      fallback.isCyrillic(humanText)
        ? `Сообщение отклонено протоколом (${code}). Ничего не отправлено.`
        : `Rejected by the protocol (${code}). Nothing was transmitted.`,
    );
  }

  /**
   * Agent B could not resolve the task — answer with a machine-readable ERROR
   * frame rather than silence.
   * @param {unknown} err
   * @param {string} replyTo
   * @param {string} intent
   */
  async sendErrorFrame(err, replyTo, intent) {
    const code = isProtocolError(err) ? err.code : 'E_INTERNAL';
    await this.stage('REJECTED', `${code}`, false);
    this.hub.broadcast(rejectEvent(this.id, code, err instanceof Error ? err.message : String(err)));
    try {
      const { frame } = encodeFrame({
        type: 'ERROR',
        intent,
        params: { CODE: code.replace(/[^A-Z0-9_]/g, '_'), AT: this.id },
        id: this.ids.next(),
        reply: replyTo,
      });
      this.hub.transmit(this.id, this.peer, frame);
    } catch {
      // If even the error frame will not encode, staying silent is correct:
      // malformed bytes must never reach the wire.
    }
  }

  /** @param {unknown} err */
  async failLoudly(err) {
    const message = err instanceof Error ? err.message : String(err);
    await this.stage('REJECTED', message.slice(0, 120), false);
    this.hub.broadcast(rejectEvent(this.id, 'E_INTERNAL', message));
  }
}
