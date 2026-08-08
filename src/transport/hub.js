/**
 * Connection hub.
 *
 * Owns every browser socket, knows which laptop is Agent A and which is Agent
 * B, and — most importantly — owns the AI-to-AI channel.
 *
 * The invariant this file exists to enforce:
 *
 *   The only payload that can cross from one agent to the other is a string
 *   that decodes as a valid HYPERLINK frame. There is no code path, anywhere,
 *   that hands human language to a peer agent.
 */

import { decodeFrame } from '../protocol/decoder.js';
import { ProtocolError } from '../protocol/errors.js';
import { frameEvent, humanEvent, presenceEvent } from './envelope.js';

/** @typedef {import('./envelope.js').AgentId} AgentId */

/**
 * Minimal shape we need from a socket — keeps the hub testable without ws.
 * @typedef {object} SocketLike
 * @property {(data: string) => void} send
 * @property {number} [readyState]
 */

/** @typedef {(frame: string, decoded: import('../protocol/decoder.js').DecodedFrame) => void} FrameHandler */

export class Hub {
  constructor() {
    /** @type {Map<SocketLike, AgentId>} */
    this.clients = new Map();
    /** @type {Map<AgentId, FrameHandler>} */
    this.receivers = new Map();
    /** @type {{dir: string, frame: string, at: number}[]} */
    this.wireLog = [];
  }

  /**
   * @param {SocketLike} socket
   * @param {AgentId} agent
   */
  attach(socket, agent) {
    this.clients.set(socket, agent);
    this.broadcast(presenceEvent(this.presence()));
  }

  /** @param {SocketLike} socket */
  detach(socket) {
    this.clients.delete(socket);
    this.broadcast(presenceEvent(this.presence()));
  }

  /** @returns {{a: boolean, b: boolean}} */
  presence() {
    let a = false;
    let b = false;
    for (const agent of this.clients.values()) {
      if (agent === 'A') a = true;
      if (agent === 'B') b = true;
    }
    return { a, b };
  }

  /**
   * Register the runtime that should act on frames addressed to an agent.
   * @param {AgentId} agent
   * @param {FrameHandler} handler
   */
  onFrame(agent, handler) {
    this.receivers.set(agent, handler);
  }

  /**
   * Send to every connected browser. Used for protocol-level events, which are
   * safe for both laptops to see — that is the point of the split-screen.
   * @param {object} event
   */
  broadcast(event) {
    const payload = JSON.stringify(event);
    for (const socket of this.clients.keys()) {
      this.#write(socket, payload);
    }
  }

  /**
   * Send to the browsers of one agent only. Human language uses this path and
   * only this path.
   * @param {AgentId} agent
   * @param {object} event
   */
  emitTo(agent, event) {
    const payload = JSON.stringify(event);
    for (const [socket, id] of this.clients.entries()) {
      if (id === agent) this.#write(socket, payload);
    }
  }

  /**
   * Deliver human language to the agent that owns the conversation.
   * Deliberately takes an explicit agent id and never a "peer" argument.
   * @param {AgentId} agent
   * @param {'in'|'out'} role
   * @param {string} text
   */
  human(agent, role, text) {
    this.emitTo(agent, humanEvent(agent, role, text));
  }

  /**
   * THE AI-TO-AI CHANNEL.
   *
   * @param {AgentId} from
   * @param {AgentId} to
   * @param {string} frame
   * @returns {import('../protocol/decoder.js').DecodedFrame}
   * @throws {ProtocolError} if the payload is not a valid HYPERLINK frame
   */
  transmit(from, to, frame) {
    // Re-decode on the wire even though the sender just encoded it. The cost is
    // microseconds and it makes "only frames cross this boundary" a property of
    // the transport, not a promise made by the caller.
    const decoded = decodeFrame(frame);

    const dir = /** @type {'A>B'|'B>A'} */ (`${from}>${to}`);
    this.wireLog.push({ dir, frame, at: Date.now() });
    if (this.wireLog.length > 200) this.wireLog.shift();

    // Both laptops see the packet — it is machine language, so there is nothing
    // to leak. The human sentence never travels with it.
    this.broadcast(frameEvent(dir, frame, {
      type: decoded.type,
      intent: decoded.intent,
      params: decoded.params,
      id: decoded.id,
      reply: decoded.reply,
    }));

    const handler = this.receivers.get(to);
    if (!handler) {
      throw new ProtocolError('E_NOT_A_FRAME', `no agent runtime registered for ${to}`);
    }
    handler(frame, decoded);
    return decoded;
  }

  /**
   * @param {SocketLike} socket
   * @param {string} payload
   */
  #write(socket, payload) {
    // readyState 1 === OPEN for both ws and the browser WebSocket.
    if (socket.readyState !== undefined && socket.readyState !== 1) return;
    try {
      socket.send(payload);
    } catch {
      this.clients.delete(socket);
    }
  }
}
