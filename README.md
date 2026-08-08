# HYPERLINK

**AI-TO-AI COMMUNICATION**

Two AI agents. Humans speak to them in ordinary language. The agents speak to
*each other* in a strict machine-native protocol — and natural language is
structurally incapable of crossing that link.

```
Human ──▶ AI Agent A ──▶ HYPERLINK ──▶ AI Agent B
                                            │
Human ◀── AI Agent A ◀── HYPERLINK ◀────────┘
```

---

## Quick start (for a beginner)

**1. What command do I run?**

Open Terminal, then:

```bash
cd "/Users/alikhankuralbay/Desktop/Claude Code/hyperlink" && npm install && npm start
```

The server prints something like:

```
  HYPERLINK SERVER

  Local:    http://localhost:3000
  Network:  http://192.168.1.42:3000
```

Write down the **Network** address. That is the one the second laptop needs.

**2. What do I open on Laptop A?** (the laptop running the server)

```
http://localhost:3000/?agent=A
```

**3. What do I open on Laptop B?** (any laptop on the same Wi-Fi)

```
http://YOUR_NETWORK_IP:3000/?agent=B
```

Use the exact `Network:` address the server printed — for example
`http://192.168.1.42:3000/?agent=B`.

**4. What do I type?**

On Laptop A, click **SOUND OFF** in the top right to switch sound on, then click
the **Meeting** button — or type into the box and press Enter:

```
Can you find a meeting time tomorrow after 6 PM?
```

**5. How do I know the two AI agents are communicating?**

Watch all four of these happen at once:

- **Agent A's pipeline** lights up: `UNDERSTANDING HUMAN` → `INTENT EXTRACTED` →
  `SWITCHING TO HYPERLINK` → `TRANSMITTING`.
- **The Exchange column draws the conversation.** Two vertical lifelines, A on
  the left and B on the right. Each frame draws itself as a rung with an arrow
  pointing the way it travelled — amber going out, mint coming back. You hear a
  rising two-tone chirp going out and a falling one coming back.
- **A bracket ties the answer to the question.** When B replies, a bracket on
  the right of the ladder joins its rung back to the one it answers, captioned
  `↳003`. That mark is the proof the two machines are in one conversation
  rather than talking past each other.
- **Both laptops show the same frames**, with the raw string at the bottom of
  each card (click a card to copy it):
  ```
  HL/0.1|TASK|MEETING|DATE=TOMORROW|DURATION_MIN=30|TIME_AFTER=1800|ID=003
  HL/0.1|RESULT|MEETING|AVAILABLE=TRUE|ROOM=VEGA|TIME=1930|ID=004|REPLY=003
  ```
  Notice `REPLY=003` — that is B answering A's exact message.
- **Agent A tells you the answer in English**: *"Agent B found an available
  time: 19:30, room VEGA."*

**The proof that it is real AI-to-AI communication:** look at Agent B's
HUMAN CHANNEL on either screen. It is **empty and locked**. Agent B never
received your sentence — only the frame. The English answer was reconstructed
by Agent A from `TIME=1930`, on its own side of the link.

### Prove the security boundary live

Open **PROTOCOL CONSOLE** at the bottom and inject this:

```
HL/0.1|TASK|WEATHER|CITY="Какая погода сегодня?"|DATE=TODAY|ID=910
```

The encoder refuses it (`E_NL_DETECTED`), a REFUSED card appears, the Rejected
counter turns red — and **Frames does not move**. Nothing was transmitted, and
no rung is drawn on the ladder.

---

## Real AI with Ollama

By default the agents reason with a local model through Ollama. Install it,
then:

```bash
ollama serve
ollama pull llama3.2
```

Restart HYPERLINK. The badge in the top bar switches from `AI FALLBACK` to
`OLLAMA:llama3.2`, and the pipeline notes show the model doing the reasoning.

The model is **not** hardcoded anywhere. Change it with environment variables
(see `.env.example`):

```bash
OLLAMA_MODEL=qwen2.5 npm start
OLLAMA_BASE_URL=http://192.168.1.50:11434 OLLAMA_MODEL=mistral npm start
```

**If Ollama is not running, the demo still works.** The agents fall back to a
built-in deterministic reasoner and the badge says `AI FALLBACK`, so nobody is
ever misled about which brain is answering. That is deliberate: a live demo
should not depend on a daemon being up, and it should never lie about it.

---

## How it actually works

The AI is never allowed to write a protocol frame. It emits JSON; a separate
encoder builds the frame and is the only component that can:

```
AI output (loose JSON)
   ↓  normalize.js      coerce toward machine tokens, or drop the value
structured JSON
   ↓  encoder.js        the ONLY component that may construct a frame
   ↓  validate.js       schema, types, charset, required keys
HYPERLINK frame ────────▶ transport ────────▶ peer agent
        ✗ rejected → nothing is transmitted
```

`hub.transmit()` re-decodes every frame on the wire even though the sender just
encoded it. "Only frames cross this boundary" is therefore a property the
transport enforces, not a promise the caller makes.

### Modules

```
src/
  protocol/   the HYPERLINK language: schema, encoder, decoder, validation
  ai/         reasoning: Ollama backend, prompts, the normalisation airlock,
              and the deterministic fallback reasoner
  transport/  WebSocket hub, envelopes, the strict AI-to-AI channel
  server/     HTTP + WS server, agent runtimes, config, LAN discovery
  domain/     Agent B's deterministic world model (bookings, calendar, weather)
  audio/      Web Audio synthesiser — every sound generated, none sampled
  frontend/   the interface (vanilla ES modules, no build step)
```

`src/protocol/` imports nothing from Node, so the **browser loads the exact same
module the server validates with** (served at `/protocol/`). The packet cards
you see are decoded client-side; the UI cannot render a packet the protocol
would reject.

### The protocol

```
HL/0.1|TASK|RESTAURANT_BOOKING|CITY=ALMATY|DATE=TOMORROW|PEOPLE=4|TIME=EVENING|ID=001
└────┘ └──┘ └────────────────┘ └───────────────────────────────────────────┘ └────┘
version type      intent                     parameters                        id
```

- **version** `HL/0.1` — anything else is rejected
- **type** `TASK` · `RESULT` · `HELLO` · `ERROR`
- **intent** from a fixed registry: `RESTAURANT_BOOKING`, `MEETING`, `WEATHER`,
  `TAXI`, `HOTEL_BOOKING`
- **parameters** `KEY=VALUE`, keys `[A-Z][A-Z0-9_]{0,23}`, values
  `-?[A-Z0-9][A-Z0-9_.:+-]{0,31}` — no spaces, no lowercase, no punctuation,
  no non-ASCII. A sentence cannot survive these character classes.
- **ID** every message; **REPLY** references the message being answered
- parameters are sorted, so encoding is deterministic and byte-reproducible
- frames are capped at 512 bytes and 16 parameters

Agents exchange a `HELLO|CAPABILITY` handshake first. Once A has confirmed the
peer speaks HL/0.1, it stops using natural language entirely — that transition
is the `SWITCHING TO HYPERLINK` stage in the UI.

---

## Commands

```bash
npm start        # run the server on 0.0.0.0:3000
npm run dev      # same, with auto-restart on file changes
npm test         # 43 tests: protocol, AI airlock, transport, full pipeline
npm run typecheck
PORT=3001 npm start
```

## Keyboard

`1`–`5` fire the demo scenarios · `S` toggles sound · `R` resets the link

## Troubleshooting

**Laptop B can't open the page.** Both laptops must be on the same Wi-Fi. Use
the `Network:` address, not `localhost` — `localhost` on Laptop B means Laptop B
itself. macOS may also prompt to allow incoming connections; allow it.

**Port 3000 is in use.** `PORT=3001 npm start`, and use `:3001` in both URLs.

**Agent B shows OFFLINE.** Nothing is open at `?agent=B` yet. The agent still
works — it lives on the server — but its column stays dark until a browser
attaches.

**No sound.** Browsers block audio until you interact with the page. Click the
sound chip first; it turns amber and reads SOUND ON.
# hyperlink
