/**
 * Components.
 *
 * The rule this file enforces everywhere: machine content is set in the
 * protocol face and shaped like a record — field name, field value, ruled
 * rows. Human content is set in the UI face and shaped like speech.
 */

import { ActivityMeter } from '/viz.js';

/**
 * @param {string} tag @param {string} [className] @param {string} [text]
 * @returns {HTMLElement}
 */
export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * @param {string} selector @param {ParentNode} [scope]
 * @returns {HTMLElement}
 */
export function qs(selector, scope = document) {
  const found = scope.querySelector(selector);
  if (!found) throw new Error(`missing element: ${selector}`);
  return /** @type {HTMLElement} */ (found);
}

const MAX_PACKETS = 30;

/** Server stage → the words an operator reads. */
export const STATE_WORDS = /** @type {Record<string, string>} */ ({
  INPUT_RECEIVED: 'Listening',
  UNDERSTANDING: 'Understanding',
  INTENT_EXTRACTED: 'Structuring',
  SWITCHING: 'Switching',
  ENCODING: 'Encoding',
  VALIDATED: 'Validated',
  TRANSMITTING: 'Transmitting',
  RECEIVED: 'Receiving',
  DECODING: 'Decoding',
  PROCESSING: 'Processing',
  ENCODING_RESULT: 'Responding',
  TRANSMITTING_BACK: 'Transmitting',
  RESULT_RECEIVED: 'Receiving',
  TRANSLATING: 'Translating',
  DELIVERED: 'Completed',
  REJECTED: 'Refused',
});

/** ── one agent ──────────────────────────────────────────────────────── */
export class AgentPanel {
  /** @param {'A'|'B'} id */
  constructor(id) {
    this.id = id;
    this.root = qs(`#agent-${id}`);
    this.netEl = qs('[data-status]', this.root);
    this.stateEl = qs('[data-state]', this.root);
    this.stream = qs('[data-packets]', this.root);
    /** @type {HTMLElement} */
    this.messages = qs('[data-messages]', this.root);
    this.seal = qs('[data-locked]', this.root);
    this.meter = new ActivityMeter(qs('[data-activity]', this.root));
  }

  /** @param {HTMLElement} transcript */
  bindTranscript(transcript) { this.messages = transcript; }

  /** @param {boolean} online */
  setPresence(online) {
    this.root.classList.toggle('online', online);
    this.netEl.textContent = online ? 'Online' : 'Offline';
  }

  /** @param {boolean} isSelf */
  setSelf(isSelf) {
    this.root.classList.toggle('self', isSelf);
    this.seal.hidden = isSelf;
  }

  /**
   * @param {string} stage server stage key
   * @param {boolean} busy
   */
  setState(stage, busy) {
    this.stateEl.textContent = STATE_WORDS[stage] ?? 'Standby';
    this.root.classList.toggle('busy', busy);
    this.root.classList.toggle('failed', stage === 'REJECTED');
    if (busy) this.meter.pulse(0.7);
  }

  idle() {
    this.stateEl.textContent = 'Standby';
    this.root.classList.remove('busy', 'failed');
  }

  /** @param {HTMLElement} card */
  pushPacket(card) {
    this.stream.append(card);
    while (this.stream.children.length > MAX_PACKETS) {
      this.stream.firstElementChild?.remove();
    }
    this.stream.scrollTop = this.stream.scrollHeight;
  }

  /** @param {'in'|'out'} role @param {string} text */
  pushMessage(role, text) {
    this.messages.querySelector('.transcript-idle')?.remove();
    const line = el('div', `line ${role === 'in' ? 'human' : 'agent'}`);
    line.append(el('span', 'line-who', role === 'in' ? 'You' : `Agent ${this.id}`));
    line.append(el('p', 'line-text', text));
    this.messages.append(line);
    this.messages.scrollTop = this.messages.scrollHeight;
  }
}

/** ── protocol packet ────────────────────────────────────────────────── */

/**
 * @typedef {object} FrameRecord
 * @property {number} seq
 * @property {'A>B'|'B>A'} dir
 * @property {{type: string, intent: string, params: Record<string,string>, id: string, reply?: string}} decoded
 * @property {string} raw
 */

/**
 * A frame, rendered as telemetry. It is a <button> so it is focusable and
 * keyboard-operable without inventing any of that behaviour by hand.
 * @param {FrameRecord & {side: 'OUT'|'IN'}} input
 * @returns {HTMLButtonElement}
 */
export function packetCard(input) {
  const { decoded, raw, dir, side, seq } = input;
  const card = /** @type {HTMLButtonElement} */ (document.createElement('button'));
  card.type = 'button';
  card.className = `packet ${decoded.type.toLowerCase()}`;
  card.dataset.seq = String(seq);
  card.setAttribute('aria-label',
    `Transmission ${seq}, ${decoded.type} ${decoded.intent}, ${side === 'OUT' ? 'sent' : 'received'}. Open inspector.`);

  const head = el('header', 'packet-head');
  head.append(el('span', undefined, `HYPERLINK / ${decoded.type}`));
  head.append(el('span', 'packet-dir', `${side === 'OUT' ? '▸' : '◂'} ${dir}`));
  card.append(head);

  card.append(el('h4', 'packet-intent', decoded.intent.replace(/_/g, ' ')));

  const fields = el('dl', 'packet-fields');
  for (const [key, value] of Object.entries(decoded.params)) {
    const row = el('div', 'pf');
    row.append(el('dt', undefined, key), el('dd', undefined, value));
    fields.append(row);
  }
  const idRow = el('div', 'pf');
  idRow.append(el('dt', undefined, 'ID'), el('dd', undefined, decoded.id));
  fields.append(idRow);
  if (decoded.reply) {
    const r = el('div', 'pf');
    r.append(el('dt', undefined, 'REPLY'), el('dd', undefined, decoded.reply));
    fields.append(r);
  }
  card.append(fields);

  const foot = el('footer', 'packet-foot');
  foot.append(el('i'), el('span', undefined, 'Validated'));
  card.append(foot);
  return card;
}

/**
 * A frame that never left.
 * @param {{code: string, message: string}} input
 * @returns {HTMLElement}
 */
export function rejectCard({ code, message }) {
  const card = el('article', 'packet refused');
  const head = el('header', 'packet-head');
  head.append(el('span', undefined, 'HYPERLINK / REFUSED'));
  head.append(el('span', 'packet-dir', 'not transmitted'));
  card.append(head);
  card.append(el('h4', 'packet-intent', code));

  const fields = el('dl', 'packet-fields');
  const row = el('div', 'pf');
  row.append(el('dt', undefined, 'REASON'), el('dd', undefined, message));
  fields.append(row);
  card.append(fields);

  const foot = el('footer', 'packet-foot');
  foot.append(el('i'), el('span', undefined, 'Rejected by encoder'));
  card.append(foot);
  return card;
}

/** ── communication timeline ─────────────────────────────────────────── */

/** The full round trip, in order. Steps light up from real stage events. */
const STEPS = [
  ['A', 'INPUT_RECEIVED', 'Listening'],
  ['A', 'UNDERSTANDING', 'Understanding human'],
  ['A', 'INTENT_EXTRACTED', 'Structuring request'],
  ['A', 'SWITCHING', 'Switching to HYPERLINK'],
  ['A', 'ENCODING', 'Encoding frame'],
  ['A', 'VALIDATED', 'Protocol validation'],
  ['A', 'TRANSMITTING', 'Transmitting'],
  ['B', 'RECEIVED', 'Agent B received'],
  ['B', 'DECODING', 'Decoding'],
  ['B', 'PROCESSING', 'Processing'],
  ['B', 'ENCODING_RESULT', 'Response created'],
  ['B', 'VALIDATED', 'Protocol validation'],
  ['B', 'TRANSMITTING_BACK', 'Transmitting back'],
  ['A', 'RESULT_RECEIVED', 'Agent A received'],
  ['A', 'DECODING', 'Decoding'],
  ['A', 'TRANSLATING', 'Rebuilding for human'],
  ['A', 'DELIVERED', 'Delivered'],
];

export class Timeline {
  /** @param {HTMLElement} host */
  constructor(host) {
    this.host = host;
    /** @type {Map<string, HTMLElement>} */
    this.rows = new Map();
    this.current = -1;

    for (const [owner, stage, label] of STEPS) {
      const row = el('li', 'tl');
      row.dataset.owner = String(owner);
      row.append(el('span', 'tl-tick'));
      row.append(el('span', 'tl-label', String(label)));
      row.append(el('span', 'tl-owner', String(owner)));
      host.append(row);
      this.rows.set(`${owner}:${stage}`, row);
    }
  }

  reset() {
    this.current = -1;
    for (const row of this.rows.values()) row.classList.remove('done', 'now', 'failed');
  }

  /**
   * @param {'A'|'B'} agent
   * @param {string} stage
   */
  mark(agent, stage) {
    const key = `${agent}:${stage}`;
    const row = this.rows.get(key);
    if (!row) return;

    const index = STEPS.findIndex(([o, s]) => `${o}:${s}` === key);
    if (index < 0) return;
    // A new run starts from the top rather than resuming a stale sequence.
    if (index === 0) this.reset();
    this.current = index;

    STEPS.forEach(([o, s], i) => {
      const r = this.rows.get(`${o}:${s}`);
      if (!r) return;
      r.classList.remove('now', 'failed');
      r.classList.toggle('done', i < index);
    });
    row.classList.add('now');
    row.scrollIntoView({ block: 'nearest' });
  }

  /** Mark wherever the sequence stopped as failed. */
  fail() {
    if (this.current < 0) return;
    const step = STEPS[this.current];
    if (!step) return;
    const row = this.rows.get(`${step[0]}:${step[1]}`);
    if (row) { row.classList.remove('now'); row.classList.add('failed'); }
  }
}

/** ── system status ──────────────────────────────────────────────────── */

export class SystemStatus {
  constructor() {
    /** @type {Record<string, HTMLElement>} */
    this.rows = {
      network: qs('#sys-network'),
      socket: qs('#sys-socket'),
      agentA: qs('#sys-agent-a'),
      agentB: qs('#sys-agent-b'),
      ai: qs('#sys-ai'),
      protocol: qs('#sys-protocol'),
      sound: qs('#sys-sound'),
    };
  }

  /**
   * @param {keyof SystemStatus['rows'] | string} key
   * @param {'up'|'warn'|'down'} state
   * @param {string} text
   */
  set(key, state, text) {
    const row = this.rows[key];
    if (!row) return;
    row.classList.remove('up', 'warn', 'down');
    row.classList.add(state);
    const span = row.querySelector('dd span');
    if (span) span.textContent = text;
  }
}

/** ── protocol inspector ─────────────────────────────────────────────── */

export class Inspector {
  /**
   * @param {HTMLElement} root @param {HTMLElement} body @param {HTMLElement} closeBtn
   */
  constructor(root, body, closeBtn) {
    this.root = root;
    this.body = body;
    this.closeBtn = closeBtn;
    /** @type {HTMLElement | null} */
    this.opener = null;

    closeBtn.addEventListener('click', () => this.close());
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !this.root.hidden) this.close();
    });
  }

  /**
   * @param {FrameRecord} record
   * @param {HTMLElement} [opener] element to return focus to
   */
  open(record, opener) {
    const { decoded, raw, dir, seq } = record;
    const from = dir[0];
    const to = dir[2];

    this.body.replaceChildren();
    /**
     * @param {string} key @param {string} value @param {string} [tone]
     */
    const row = (key, value, tone) => {
      const wrap = el('div', 'insp-row');
      wrap.append(el('div', 'insp-key', key));
      wrap.append(el('p', tone ? `insp-val ${tone}` : 'insp-val', value));
      this.body.append(wrap);
      return wrap;
    };

    row('Status', 'Validated', 'ok');
    row('Source', `Agent ${from}`, from === 'A' ? 'tone-a' : 'tone-b');
    row('Destination', `Agent ${to}`, to === 'A' ? 'tone-a' : 'tone-b');
    row('Protocol', 'HL/0.1');
    row('Type', decoded.type);
    row('Intent', decoded.intent);

    const params = el('div', 'insp-row');
    params.append(el('div', 'insp-key', 'Parameters'));
    const list = el('dl', 'insp-params');
    for (const [k, v] of Object.entries(decoded.params)) {
      const line = el('div');
      line.append(el('dt', undefined, k), el('dd', undefined, v));
      list.append(line);
    }
    params.append(list);
    this.body.append(params);

    row('Message ID', decoded.id);
    row('Reference', decoded.reply ?? '—');

    const wire = el('div', 'insp-row');
    wire.append(el('div', 'insp-key', 'Wire'));
    wire.append(el('p', 'insp-raw', raw));
    this.body.append(wire);

    const title = document.getElementById('inspector-title');
    if (title) title.textContent = `Transmission #${String(seq).padStart(4, '0')}`;

    this.opener = opener ?? /** @type {HTMLElement|null} */ (document.activeElement);
    this.root.hidden = false;
    this.closeBtn.focus();
  }

  close() {
    if (this.root.hidden) return;
    this.root.hidden = true;
    // Focus goes back where it came from, not to the top of the document.
    if (this.opener && this.opener.isConnected) this.opener.focus();
    this.opener = null;
  }
}

/** ── toasts & counters ──────────────────────────────────────────────── */

export class Toasts {
  /** @param {HTMLElement} host */
  constructor(host) { this.host = host; }

  /**
   * @param {string} text @param {'info'|'warn'|'bad'} [kind] @param {number} [ms]
   */
  show(text, kind = 'info', ms = 4200) {
    const node = el('div', kind === 'info' ? 'toast' : `toast ${kind}`, text);
    this.host.append(node);
    setTimeout(() => {
      node.classList.add('out');
      setTimeout(() => node.remove(), 200);
    }, ms);
  }
}

export class Stats {
  constructor() {
    this.frames = 0;
    this.bytes = 0;
    this.rejects = 0;
    this.framesEl = qs('#stat-frames');
    this.bytesEl = qs('#stat-bytes');
    this.rejectsEl = qs('#stat-rejects');
  }

  /** @param {number} bytes */
  countFrame(bytes) { this.frames += 1; this.bytes += bytes; this.render(); }
  countReject() { this.rejects += 1; this.render(); }

  render() {
    this.framesEl.textContent = String(this.frames);
    this.bytesEl.textContent = String(this.bytes);
    this.rejectsEl.textContent = String(this.rejects);
    this.rejectsEl.classList.toggle('hot', this.rejects > 0);
  }
}
