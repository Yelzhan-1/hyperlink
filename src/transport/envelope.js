/**
 * Wire envelopes.
 *
 * Two very different channels live in this app and they must never be
 * confused:
 *
 *   browser ↔ server   rich UI events, may contain human language
 *   agent   ↔ agent    HYPERLINK frames only, never human language
 *
 * This module types the first one and refuses to model the second at all:
 * there is deliberately no "send text to peer" envelope, because the only
 * thing an agent may hand another agent is a frame.
 */

/** @typedef {'A'|'B'} AgentId */

/**
 * @typedef {object} ClientMessage
 * @property {string} t
 * @property {string} [text]
 * @property {string} [frame]
 * @property {string} [id]
 */

/** Everything a client is allowed to say. */
export const CLIENT_MESSAGE_TYPES = ['hello', 'human', 'demo', 'inject', 'reset', 'ping'];

/**
 * Parse and sanity-check an inbound client message.
 * @param {unknown} raw
 * @returns {ClientMessage | null}
 */
export function parseClientMessage(raw) {
  if (typeof raw !== 'string' || raw.length > 8000) return null;
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const msg = /** @type {Record<string, unknown>} */ (parsed);
  const t = msg.t;
  if (typeof t !== 'string' || !CLIENT_MESSAGE_TYPES.includes(t)) return null;

  /** @type {ClientMessage} */
  const out = { t };
  if (typeof msg.text === 'string') out.text = msg.text.slice(0, 2000);
  if (typeof msg.frame === 'string') out.frame = msg.frame.slice(0, 2000);
  if (typeof msg.id === 'string') out.id = msg.id.slice(0, 64);
  return out;
}

/** Pipeline stages, in the order an operator sees them light up. */
export const STAGES = /** @type {const} */ ({
  IDLE: 'IDLE',
  INPUT_RECEIVED: 'INPUT RECEIVED',
  UNDERSTANDING: 'UNDERSTANDING HUMAN',
  INTENT_EXTRACTED: 'INTENT EXTRACTED',
  SWITCHING: 'SWITCHING TO HYPERLINK',
  ENCODING: 'ENCODING FRAME',
  VALIDATED: 'FRAME VALIDATED',
  TRANSMITTING: 'TRANSMITTING',
  RECEIVED: 'FRAME RECEIVED',
  DECODING: 'DECODING',
  PROCESSING: 'PROCESSING TASK',
  ENCODING_RESULT: 'ENCODING RESULT',
  TRANSMITTING_BACK: 'TRANSMITTING BACK',
  RESULT_RECEIVED: 'RESULT RECEIVED',
  TRANSLATING: 'TRANSLATING TO HUMAN',
  DELIVERED: 'DELIVERED',
  REJECTED: 'REJECTED',
});

/** @typedef {keyof typeof STAGES} StageKey */

/**
 * @param {AgentId} agent
 * @param {StageKey} stage
 * @param {string} [note]
 */
export const stageEvent = (agent, stage, note = '') => ({
  t: 'stage',
  agent,
  stage,
  label: STAGES[stage],
  note,
  at: Date.now(),
});

/**
 * @param {'A>B'|'B>A'} dir
 * @param {string} frame
 * @param {unknown} decoded
 */
export const frameEvent = (dir, frame, decoded) => ({
  t: 'frame',
  dir,
  frame,
  decoded,
  at: Date.now(),
});

/**
 * Human language. Scoped to one agent by construction — the hub will only ever
 * deliver this to the agent that owns the conversation.
 * @param {AgentId} agent
 * @param {'in'|'out'} role
 * @param {string} text
 */
export const humanEvent = (agent, role, text) => ({
  t: 'human',
  agent,
  role,
  text,
  at: Date.now(),
});

/**
 * @param {AgentId} agent
 * @param {string} code
 * @param {string} message
 * @param {Record<string, unknown>} [detail]
 */
export const rejectEvent = (agent, code, message, detail = {}) => ({
  t: 'reject',
  agent,
  code,
  message,
  detail,
  at: Date.now(),
});

/**
 * @param {{a: boolean, b: boolean}} presence
 */
export const presenceEvent = (presence) => ({
  t: 'presence',
  a: presence.a,
  b: presence.b,
  at: Date.now(),
});

/**
 * @param {{label: string, online: boolean, status: string, provider: string, model: string}} ai
 */
export const aiEvent = (ai) => ({ t: 'ai', ...ai, at: Date.now() });

/**
 * @param {string} text
 * @param {'info'|'warn'|'error'} [level]
 */
export const logEvent = (text, level = 'info') => ({ t: 'log', level, text, at: Date.now() });
