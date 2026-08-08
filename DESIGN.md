# HYPERLINK — design system

Single source of truth for the interface. Every token lives once in
`src/frontend/styles.css` under `:root`; nothing hardcodes a colour, duration
or spacing step.

The system carries one idea: **two different machines are negotiating, and
there is a border human language cannot cross.**

---

## Provenance

Established with `ui-ux-pro-max` (`scripts/search.py`) and `frontend-design`,
with `interface-design`, `baseline-ui`, `emil-design-eng`,
`fixing-accessibility`, `fixing-motion-performance` and `fixing-metadata`
applied as constraints.

**Style — "Modern Dark" / real-time operations.** Queried for *"AI network
protocol telemetry operations console futuristic cinematic dark cyan"*. Colour
strategy taken verbatim: *"Dark or neutral. Status colors. Data-dense but
scannable."* The **"Bento Grids"** style the `--variance 8` dial surfaced was
**declined** — modular rounded cards are the template look this brief
explicitly rejects.

**Typography — Inter.** The pairing whose mood string returned *"dark,
cinematic, technical, precision, clean, premium, developer, professional,
high-end utility"* — the brief almost word for word. Adopted for the brand and
UI roles. Loaded from the system stack, not Google Fonts: this app is demoed on
a LAN between two laptops with no guaranteed internet, so a webfont would risk
a flash of unstyled text at exactly the wrong moment.

**Palette — "Editor violet + filter cyan on dark".** Background `#0F172A`,
card `#192134`, violet `#7C3AED`, cyan `#0891B2`. Adopted and darkened one step
(`#05070d`) for cinema contrast. The database's own note — *"Accent adjusted
from #06B6D4 for WCAG 3:1"* — is why the cyan here is the brighter `#22D3EE`
tier: the recommended value does not clear AA in the small mono labels it has
to sit in.

`baseline-ui` is written for Tailwind + `motion/react`; this project has
neither. Its *constraints* are applied to the hand-written CSS instead —
compositor-only animation, no `transition: all`, no parked `will-change`,
`tabular-nums` on data, `text-pretty` on prose, a fixed z-index scale. Its
stack rules (Radix/Base UI primitives, `cn`, `tw-animate-css`) do not apply.

---

## Colour

Two agent identities that never mix, and one colour where they meet.

| Token | Value | Role | Contrast on panel |
|---|---|---|---|
| `--void` | `#05070d` | page | — |
| `--deep` | `#080d16` | wells: state box, inputs | — |
| `--panel` | `#0e1421` | agent columns, signal | — |
| `--panel-2` | `#131a29` | packets, buttons | — |
| `--line` | `#1d263c` | borders | — |
| `--ink` | `#eaf2ff` | primary text | 16.9:1 |
| `--ink-2` | `#b3c4dc` | values, transcript | 9.4:1 |
| `--ink-3` | `#8ea1bd` | secondary | 6.3:1 |
| `--ink-4` | `#6b7e9b` | dimmest text tier | 4.5:1 |
| `--cyan` | `#22d3ee` | **Agent A**, outbound | 11.0:1 |
| `--violet` | `#a78bfa` | **Agent B**, inbound | 7.9:1 |
| `--magenta` | `#e879f9` | the midpoint of the link | 8.3:1 |
| `--ok` / `--warn` / `--bad` | `#34d399` / `#fbbf24` / `#fb7185` | status | ≥5:1 |

**Rules.**
- Cyan is Agent A. Violet is Agent B. Neither ever appears in the other's column.
- **Magenta appears exactly once** — the centre stop of the signal gradient,
  the only point where the two systems touch. It is not a UI colour.
- **Nothing glows at rest.** Glow is applied only to elements the system is
  actively using: a live node, a working agent, the current timeline step.
- `--bad` means refused. It is never decorative.

## Typography

Three roles, one hard rule:

> **Human language is set in the UI face. Machine language is set in the
> protocol face. Nothing is set in both.**

```
--font-brand : Inter, ui-sans-serif, system-ui, -apple-system, …   (wordmark, headings, counters)
--font-ui    : Inter, ui-sans-serif, system-ui, -apple-system, …   (human speech, controls)
--font-mono  : SF Mono, ui-monospace, JetBrains Mono, Menlo, …     (frames, states, labels, IDs)
```

| Role | Size / weight | Face |
|---|---|---|
| Wordmark | 17px / 700 / `.26em` | brand |
| Section heading | 15px / 600 | brand |
| Counter | 20px / 600, `tabular-nums` | brand |
| Human speech | 15px / 1.55 | UI |
| Agent state | 15px / `.06em` | mono |
| Packet field | 10.5px | mono |
| Micro label | 8.5–9px / `.18–.24em` uppercase | mono |

## Space, radius, z-index

```
--s1 4  --s2 8  --s3 12  --s4 16  --s5 20  --s6 28  --s7 40
--r-out 8px   --r-in 4px          (outer = inner + padding)
--z-deck 1  --z-sticky 10  --z-drawer 40  --z-toast 50
```

Hit targets ≥44px for inputs and primary buttons, ≥32px everywhere else.

## Motion

```
--t-flick   90ms   --t-fast  160ms   --t-enter 240ms
--t-state  420ms   --t-travel 900ms
--e-out    cubic-bezier(.22, 1, .36, 1)
--e-sharp  cubic-bezier(.4, 0, .2, 1)
```

Motion must guide attention, communicate state, or preserve continuity.

- **Compositor only.** Every animation is `transform` and/or `opacity`. Nothing
  animates `width`, `height`, `top`, `left`, `margin`, `padding`.
- **Every loop has a stop condition.** The signal path and both activity meters
  stop requesting frames when nothing is moving, and pause on a hidden tab.
- **`will-change` is scoped to the animation**, applied via a `.live` class and
  removed when the motion settles. It is never parked on idle elements.
- **Reads never interleave with writes** in a frame.
- **`prefers-reduced-motion`** removes travel, not state: the packet does not
  fly, but the destination node still lights and every label still changes.

## Components

| Component | Notes |
|---|---|
| `AgentPanel` | identity, live state word, activity meter, protocol stream |
| `ProtocolPacket` | a `<button>` — focusable and keyboard-operable natively |
| `ProtocolInspector` | right drawer; Escape closes, focus returns to the packet |
| `SignalPath` | canvas: two nodes, travelling packets, arrival pulses |
| `Timeline` | all 17 steps of the round trip; past / current / future |
| `SystemStatus` | network, socket, both agents, AI backend, protocol, sound |
| `Toasts`, `Stats` | transient notices; frame / byte / refusal counters |

## Accessibility baseline

- Inputs bound to visible labels via `for`/`id`.
- Live regions: both agent states, the transcript, the toast rail.
- Focus visible everywhere — 2px cyan at 2px offset via `:focus-visible`.
- The inspector is a real dialog: Escape closes it and focus returns to the
  packet that opened it.
- Packets are `<button>`s with descriptive `aria-label`s, not clickable divs.
- Status readouts are not focusable; only controls are.
- Disabled submit explains itself — the composer label states what it is
  waiting for, and the form sets `aria-busy`.
- All text meets WCAG AA against its own surface.
- No emoji as iconography; every control carries a text label.
