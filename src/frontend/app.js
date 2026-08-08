/**
 * HYPERLINK client.
 *
 * Opens the WebSocket, turns real protocol events into interface, and plays
 * the synthesised transmission sounds. Every visual state here is driven by an
 * event the transport actually emitted — nothing is on a timer, nothing is
 * simulated. Frames are decoded in the browser by the same module the server
 * validates with, so the UI cannot draw a packet the protocol would refuse.
 */

import { AudioEngine } from '/audio/engine.js';
import {
  AgentPanel, Inspector, Stats, SystemStatus, Timeline, Toasts,
  packetCard, qs, rejectCard,
} from '/ui.js';
import { SignalPath } from '/viz.js';
import { decodeFrame } from '/protocol/index.js';

const params = new URLSearchParams(location.search);
/** @type {'A'|'B'} */
const ME = (params.get('agent') ?? 'A').toUpperCase() === 'B' ? 'B' : 'A';
/** @type {'A'|'B'} */
const PEER = ME === 'A' ? 'B' : 'A';

const panels = { A: new AgentPanel('A'), B: new AgentPanel('B') };
const toasts = new Toasts(qs('#toasts'));
const stats = new Stats();
const status = new SystemStatus();
const audio = new AudioEngine();
const timeline = new Timeline(qs('#timeline'));
const signal = new SignalPath(
  /** @type {HTMLCanvasElement} */ (qs('#signal-canvas')),
  qs('.signal-stage'),
);
const inspector = new Inspector(qs('#inspector'), qs('#inspector-body'), qs('#inspector-close'));

const linkLabel = qs('#link-label');
const soundBtn = /** @type {HTMLButtonElement} */ (qs('#sound-toggle'));
const resetBtn = /** @type {HTMLButtonElement} */ (qs('#reset-link'));
const composer = /** @type {HTMLFormElement} */ (qs('#composer'));
const composerLabel = qs('#composer-label');
const humanInput = /** @type {HTMLInputElement} */ (qs('#human-input'));
const frameInput = /** @type {HTMLInputElement} */ (qs('#frame-input'));
const sendBtn = /** @type {HTMLButtonElement} */ (qs('#send'));
const injectBtn = /** @type {HTMLButtonElement} */ (qs('#inject'));
const exampleHost = qs('#scenarios');
const transcript = qs('#transcript');

const COMPOSER_IDLE = `Speak to Agent ${ME}`;

/** Every frame seen this session, so the inspector can reopen any of them. */
/** @type {Map<number, import('/ui.js').FrameRecord>} */
const ledger = new Map();
let sequence = 0;

panels.A.setSelf(ME === 'A');
panels.B.setSelf(ME === 'B');
panels[ME].bindTranscript(transcript);
composerLabel.textContent = COMPOSER_IDLE;
humanInput.setAttribute('aria-label', `Message to Agent ${ME}`);
document.title = `HYPERLINK — Agent ${ME}`;
status.set('protocol', 'up', 'HL/0.1');

/** @type {WebSocket | null} */
let socket = null;
let reconnectDelay = 600;

/** @param {string} text @param {string} [tone] */
function setLink(text, tone) {
  linkLabel.textContent = text;
  linkLabel.className = tone ? `signal-state ${tone}` : 'signal-state';
}

/** @param {object} message */
function send(message) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
    return;
  }
  toasts.show('Link is down — reconnecting.', 'warn');
}

function connect() {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  socket = new WebSocket(`${scheme}://${location.host}/ws?agent=${ME}`);

  socket.addEventListener('open', () => {
    reconnectDelay = 600;
    setLink('Idle');
    status.set('socket', 'up', 'Connected');
    status.set('network', 'up', 'Operational');
  });

  socket.addEventListener('message', (event) => {
    /** @type {any} */
    let msg;
    try { msg = JSON.parse(String(event.data)); } catch { return; }
    handle(msg);
  });

  socket.addEventListener('close', () => {
    setLink('Link lost', 'bad');
    status.set('socket', 'down', 'Disconnected');
    status.set('network', 'warn', 'Reconnecting');
    panels.A.setPresence(false);
    panels.B.setPresence(false);
    status.set('agentA', 'down', 'Offline');
    status.set('agentB', 'down', 'Offline');
    signal.setLinked(false);
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 1.7, 8000);
  });

  socket.addEventListener('error', () => socket?.close());
}

/** @param {any} msg */
function handle(msg) {
  switch (msg.t) {
    case 'welcome':
      renderExamples(msg.scenarios ?? []);
      setAi(msg.ai);
      setPresence(msg.presence);
      break;
    case 'presence': setPresence(msg); break;
    case 'ai': setAi(msg); break;
    case 'stage': onStage(msg); break;
    case 'frame': onFrame(msg); break;
    case 'human':
      panels[/** @type {'A'|'B'} */ (msg.agent)]?.pushMessage(msg.role, msg.text);
      if (msg.role === 'out') releaseComposer();
      break;
    case 'reject': onReject(msg); break;
    case 'log': toasts.show(String(msg.text), 'info', 2600); break;
    default: break;
  }
}

/** @param {{a: boolean, b: boolean}} presence */
function setPresence(presence) {
  const a = Boolean(presence?.a);
  const b = Boolean(presence?.b);
  panels.A.setPresence(a);
  panels.B.setPresence(b);
  status.set('agentA', a ? 'up' : 'down', a ? 'Online' : 'Offline');
  status.set('agentB', b ? 'up' : 'down', b ? 'Online' : 'Offline');
  signal.setLinked(a && b);
  if (a && b) setLink('Linked');
}

/** @param {{label: string, online: boolean, status: string}} ai */
function setAi(ai) {
  if (!ai) return;
  status.set('ai', ai.online ? 'up' : 'warn', ai.online ? ai.label : 'Fallback');
  qs('#sys-ai').title = ai.online
    ? `Reasoning with ${ai.label}`
    : `Model backend unreachable (${ai.status}) — deterministic reasoner active`;
}

/** @param {any} msg */
function onStage(msg) {
  /** @type {'A'|'B'} */
  const agent = msg.agent;
  const stage = String(msg.stage);

  if (stage === 'INPUT_RECEIVED') timeline.reset();
  timeline.mark(agent, stage);
  panels[agent]?.setState(stage, stage !== 'DELIVERED' && stage !== 'REJECTED');

  switch (stage) {
    case 'UNDERSTANDING':
      setLink('Reading human');
      break;
    case 'SWITCHING':
      setLink('Switching to HYPERLINK', 'out');
      audio.play('link');
      break;
    case 'TRANSMITTING':
      setLink('Transmitting A → B', 'out');
      audio.play('txStart');
      audio.burst(760);
      break;
    case 'PROCESSING':
      setLink('Agent B processing', 'back');
      break;
    case 'TRANSMITTING_BACK':
      setLink('Transmitting B → A', 'back');
      audio.play('txBack');
      audio.burst(760);
      break;
    case 'TRANSLATING':
      setLink('Rebuilding for human', 'out');
      break;
    case 'DELIVERED':
      setLink('Linked');
      panels.A.idle();
      panels.B.idle();
      break;
    case 'REJECTED':
      setLink('Refused', 'bad');
      timeline.fail();
      audio.play('reject');
      break;
    default:
      break;
  }
}

/** @param {any} msg */
function onFrame(msg) {
  /** @type {'A>B'|'B>A'} */
  const dir = msg.dir;
  const from = /** @type {'A'|'B'} */ (dir[0]);
  const to = /** @type {'A'|'B'} */ (dir[2]);

  let decoded;
  try {
    decoded = decodeFrame(msg.frame);
  } catch (err) {
    panels[from]?.pushPacket(rejectCard({
      code: 'E_CLIENT_DECODE',
      message: err instanceof Error ? err.message : String(err),
    }));
    return;
  }

  sequence += 1;
  /** @type {import('/ui.js').FrameRecord} */
  const record = { seq: sequence, dir, decoded, raw: msg.frame };
  ledger.set(sequence, record);

  panels[from]?.pushPacket(packetCard({ ...record, side: 'OUT' }));
  panels[to]?.pushPacket(packetCard({ ...record, side: 'IN' }));

  stats.countFrame(msg.frame.length);
  signal.send(dir, decoded.type);

  if (decoded.type !== 'HELLO') {
    // Sound lands when the packet lands, not when it left.
    setTimeout(() => audio.play('rx'), 700);
  }
}

/** @param {any} msg */
function onReject(msg) {
  stats.countReject();
  timeline.fail();
  panels[/** @type {'A'|'B'} */ (msg.agent)]?.pushPacket(
    rejectCard({ code: msg.code, message: msg.message }),
  );
  toasts.show(`${msg.code} — ${msg.message}`, 'bad', 6000);
  audio.play('reject');
  releaseComposer();
}

/** @param {{id: string, label: string, text: string}[]} scenarios */
function renderExamples(scenarios) {
  exampleHost.replaceChildren();
  for (const scenario of scenarios) {
    const button = document.createElement('button');
    button.type = 'button';           // it lives inside the composer form
    button.className = 'example';
    button.textContent = scenario.label.charAt(0) + scenario.label.slice(1).toLowerCase();
    button.title = scenario.text;
    button.addEventListener('click', () => {
      audio.ensureContext();
      humanInput.value = scenario.text;
      submitHuman();
    });
    exampleHost.append(button);
  }
}

/**
 * A control that goes dead without saying why is a broken control, so the
 * label — already bound to the input — carries the reason.
 */
function holdComposer() {
  sendBtn.disabled = true;
  humanInput.disabled = true;
  composer.setAttribute('aria-busy', 'true');
  composerLabel.textContent = `Waiting for Agent ${PEER}…`;
  sendBtn.title = `Waiting for Agent ${PEER} to answer`;
}

function releaseComposer() {
  sendBtn.disabled = false;
  humanInput.disabled = false;
  composer.setAttribute('aria-busy', 'false');
  composerLabel.textContent = COMPOSER_IDLE;
  sendBtn.removeAttribute('title');
}

function submitHuman() {
  const text = humanInput.value.trim();
  if (text === '') return;
  send({ t: 'human', text });
  humanInput.value = '';
  holdComposer();
  setTimeout(releaseComposer, 30000);
}

composer.addEventListener('submit', (event) => {
  event.preventDefault();
  submitHuman();
});

injectBtn.addEventListener('click', () => {
  const frame = frameInput.value.trim();
  if (frame === '') return;
  send({ t: 'inject', frame });
  frameInput.value = '';
});
frameInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') { event.preventDefault(); injectBtn.click(); }
});

soundBtn.addEventListener('click', () => {
  const on = audio.toggle();
  soundBtn.setAttribute('aria-pressed', String(on));
  const span = soundBtn.querySelector('span:last-child');
  if (span) span.textContent = on ? 'Sound on' : 'Sound off';
  status.set('sound', on ? 'up' : 'down', on ? 'Enabled' : 'Off');
});

resetBtn.addEventListener('click', () => {
  send({ t: 'reset' });
  timeline.reset();
  panels.A.idle();
  panels.B.idle();
  inspector.close();
  setLink('Idle');
});

/** Any packet opens the inspector — one delegated listener, not one per card. */
document.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const card = /** @type {HTMLElement | null} */ (target.closest('.packet[data-seq]'));
  if (!card || !card.dataset.seq) return;
  const record = ledger.get(Number(card.dataset.seq));
  if (record) inspector.open(record, card);
});

// Keyboard: 1–5 fire the examples, S toggles sound, R resets the link.
document.addEventListener('keydown', (event) => {
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;

  if (event.key >= '1' && event.key <= '9') {
    const button = exampleHost.children[Number(event.key) - 1];
    if (button instanceof HTMLElement) button.click();
    return;
  }
  if (event.key.toLowerCase() === 's') soundBtn.click();
  if (event.key.toLowerCase() === 'r') resetBtn.click();
});

setInterval(() => send({ t: 'ping' }), 25000);
connect();

// Handy on stage: drive the instruments from the console.
Object.assign(window, { HYPERLINK: { audio, signal, timeline, panels, inspector, send, ledger } });
