/**
 * HYPERLINK server — the entry point.
 *
 * Serves the UI, upgrades /ws to a WebSocket, and wires two agent runtimes to
 * one hub. Binds 0.0.0.0 by default so the second laptop on the same Wi-Fi can
 * reach it.
 */

import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

import { AiCore } from '../ai/index.js';
import { IdSequence } from '../protocol/ids.js';
import { HL_VERSION, INTENTS } from '../protocol/schema.js';
import { Hub } from '../transport/hub.js';
import { aiEvent, logEvent, parseClientMessage, presenceEvent } from '../transport/envelope.js';
import { AgentRuntime, DEMO_SCENARIOS } from './agent.js';
import { loadConfig } from './env.js';
import { lanAddresses, primaryLanAddress } from './net.js';
import { serveStatic } from './static.js';

const here = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = resolve(here, '..');
const ROOT_DIR = resolve(here, '../..');

/**
 * Build the whole application graph. Exported so tests can boot a real server
 * on an ephemeral port instead of mocking it.
 * @param {Partial<import('./env.js').Config>} [overrides]
 */
export function createApp(overrides = {}) {
  const config = { ...loadConfig(ROOT_DIR), ...overrides };
  const hub = new Hub();
  const ai = new AiCore({
    provider: config.provider,
    ollamaBaseUrl: config.ollamaBaseUrl,
    ollamaModel: config.ollamaModel,
    timeoutMs: config.timeoutMs,
    allowFallback: config.allowFallback,
  });

  // One shared sequence, so IDs read like a transcript across both agents:
  // A sends 001, B answers 002.
  const ids = new IdSequence(1);

  const agentA = new AgentRuntime({ id: 'A', peer: 'B', hub, ai, ids, stageDelayMs: config.stageDelayMs });
  const agentB = new AgentRuntime({ id: 'B', peer: 'A', hub, ai, ids, stageDelayMs: config.stageDelayMs });

  hub.onFrame('A', (frame, decoded) => { void agentA.handleFrame(frame, decoded); });
  hub.onFrame('B', (frame, decoded) => { void agentB.handleFrame(frame, decoded); });

  /** @param {import('../transport/envelope.js').AgentId} id */
  const agentById = (id) => (id === 'A' ? agentA : agentB);

  const server = createServer((req, res) => {
    if (req.url === '/api/health') {
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      });
      res.end(JSON.stringify({
        ok: true,
        protocol: HL_VERSION,
        ai: { provider: config.provider, model: config.ollamaModel, online: ai.online, status: ai.status },
        presence: hub.presence(),
      }));
      return;
    }
    void serveStatic(SRC_DIR, req, res).then((served) => {
      if (served) return;
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('not found');
    });
  });

  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (socket, req) => {
    const url = new URL(req.url ?? '/ws', 'http://localhost');
    const requested = (url.searchParams.get('agent') ?? 'A').toUpperCase();
    /** @type {import('../transport/envelope.js').AgentId} */
    const agent = requested === 'B' ? 'B' : 'A';

    hub.attach(socket, agent);

    socket.send(JSON.stringify({
      t: 'welcome',
      agent,
      protocol: HL_VERSION,
      intents: INTENTS,
      scenarios: DEMO_SCENARIOS,
      stageDelayMs: config.stageDelayMs,
      ai: {
        label: ai.label, online: ai.online, status: ai.status,
        provider: config.provider, model: config.ollamaModel,
      },
      presence: hub.presence(),
    }));

    socket.on('message', (data) => {
      const msg = parseClientMessage(typeof data === 'string' ? data : data.toString());
      if (!msg) return;

      switch (msg.t) {
        case 'human':
          // Human language enters the system here and goes no further than the
          // agent the human is talking to.
          if (msg.text) void agentById(agent).handleHuman(msg.text);
          break;

        case 'demo': {
          const scenario = DEMO_SCENARIOS.find((s) => s.id === msg.id) ?? DEMO_SCENARIOS[0];
          if (scenario) void agentById(agent).handleHuman(scenario.text);
          break;
        }

        case 'inject':
          if (msg.frame) void agentById(agent).injectFrame(msg.frame);
          break;

        case 'reset':
          agentA.pending.clear();
          agentB.pending.clear();
          agentA.busy = false;
          agentB.busy = false;
          void ai.probe().then(() => {
            hub.broadcast(aiEvent({
              label: ai.label, online: ai.online, status: ai.status,
              provider: config.provider, model: config.ollamaModel,
            }));
          });
          hub.broadcast(logEvent('link reset'));
          break;

        case 'ping':
          socket.send(JSON.stringify({ t: 'pong', at: Date.now() }));
          break;

        default:
          break;
      }
    });

    socket.on('close', () => hub.detach(socket));
    socket.on('error', () => hub.detach(socket));
  });

  return { server, wss, hub, ai, config, agents: { A: agentA, B: agentB } };
}

const ESC = String.fromCharCode(27);
/** @param {string} code @returns {string} */
const sgr = (code) => `${ESC}[${code}m`;

/**
 * Pretty boot banner — the LAN URL is the thing the second laptop needs.
 * @param {number} port
 * @param {{provider: string, model: string}} ai
 * @param {string} aiStatus
 * @returns {string}
 */
function banner(port, ai, aiStatus) {
  const lan = primaryLanAddress();
  const others = lanAddresses().slice(1);
  const c = {
    dim: sgr('2'), cyan: sgr('36'), mag: sgr('35'), green: sgr('32'),
    yellow: sgr('33'), bold: sgr('1'), off: sgr('0'),
  };

  const lines = [
    '',
    `${c.cyan}${c.bold}  +----------------------------------------------+${c.off}`,
    `${c.cyan}${c.bold}  |   H Y P E R L I N K                          |${c.off}`,
    `${c.cyan}  |   ${c.dim}AI-TO-AI COMMUNICATION . ${HL_VERSION}          ${c.off}${c.cyan}|${c.off}`,
    `${c.cyan}${c.bold}  +----------------------------------------------+${c.off}`,
    '',
    `  ${c.bold}HYPERLINK SERVER${c.off}`,
    '',
    `  Local:    ${c.green}http://localhost:${port}${c.off}`,
    lan
      ? `  Network:  ${c.green}http://${lan}:${port}${c.off}`
      : `  Network:  ${c.yellow}(no LAN interface found - connect to Wi-Fi)${c.off}`,
    '',
    `  ${c.dim}Laptop A ->${c.off}  ${c.mag}http://${lan ?? 'localhost'}:${port}/?agent=A${c.off}`,
    `  ${c.dim}Laptop B ->${c.off}  ${c.mag}http://${lan ?? 'localhost'}:${port}/?agent=B${c.off}`,
    '',
    `  AI:       ${aiStatus === 'ONLINE' ? c.green : c.yellow}${ai.provider}:${ai.model} . ${aiStatus}${c.off}`,
  ];

  if (aiStatus !== 'ONLINE') {
    lines.push(
      `            ${c.dim}running on the deterministic reasoner - the demo works either way.${c.off}`,
      `            ${c.dim}for real model reasoning:  ollama serve  &&  ollama pull ${ai.model}${c.off}`,
    );
  }
  if (others.length > 0) {
    lines.push('', `  ${c.dim}other interfaces: ${others.map((i) => `${i.address} (${i.name})`).join(', ')}${c.off}`);
  }
  lines.push('');
  return lines.join('\n');
}

// Boot only when run directly, so tests can import createApp freely.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const app = createApp();

  app.server.on('error', (err) => {
    const e = /** @type {NodeJS.ErrnoException} */ (err);
    if (e.code === 'EADDRINUSE') {
      console.error(`\n  Port ${app.config.port} is already in use.`);
      console.error('  Start on another port:  PORT=3001 npm start\n');
      process.exit(1);
    }
    throw err;
  });

  app.server.listen(app.config.port, app.config.host, () => {
    void app.ai.probe().then(() => {
      console.log(banner(
        app.config.port,
        { provider: app.config.provider, model: app.config.ollamaModel },
        app.ai.status,
      ));
      app.hub.broadcast(aiEvent({
        label: app.ai.label, online: app.ai.online, status: app.ai.status,
        provider: app.config.provider, model: app.config.ollamaModel,
      }));
      app.hub.broadcast(presenceEvent(app.hub.presence()));
    });
  });

  const shutdown = () => {
    app.wss.close();
    app.server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
