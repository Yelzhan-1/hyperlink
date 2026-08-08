/**
 * The signal layer.
 *
 * Two nodes and the link between them. When a frame crosses the wire a packet
 * physically travels the path and the receiving node reacts — the animation is
 * driven by real transport events, never by a timer pretending to be one.
 *
 * Both loops here stop when nothing is moving. An idle screen costs no frames.
 */

const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)');

const CYAN = [34, 211, 238];
const VIOLET = [167, 139, 250];
const MAGENTA = [232, 121, 249];

/** @param {number[]} c @param {number} a @returns {string} */
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

/**
 * The centre channel: node A, node B, and the packets between them.
 */
export class SignalPath {
  /** @param {HTMLCanvasElement} canvas @param {HTMLElement} stage */
  constructor(canvas, stage) {
    this.canvas = canvas;
    this.stage = stage;
    this.ctx = canvas.getContext('2d');
    /** @type {{dir: 1|-1, t: number, step: number, label: string}[]} */
    this.packets = [];
    /** @type {{A: number, B: number}} node excitement, 0..1 */
    this.nodes = { A: 0, B: 0 };
    this.linked = false;
    this.phase = 0;
    this.running = false;

    this.tick = this.tick.bind(this);
    this.resize = this.resize.bind(this);
    window.addEventListener('resize', this.resize);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.busy()) this.start();
    });
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    if (this.ctx) this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.render();
  }

  /** @returns {boolean} is there anything left to animate? */
  busy() {
    return this.packets.length > 0 || this.nodes.A > 0.01 || this.nodes.B > 0.01;
  }

  /** @param {boolean} on */
  setLinked(on) {
    this.linked = on;
    this.render();
  }

  /**
   * Launch a packet along the path.
   * @param {'A>B'|'B>A'} dir
   * @param {string} label
   */
  send(dir, label) {
    const forward = dir === 'A>B';
    this.linked = true;

    // No travel when motion is reduced, and none when the tab is hidden: a
    // backgrounded tab gets no animation frames, so a queued packet would sit
    // frozen at the start of the path instead of arriving. The arrival still
    // registers either way, so no state is lost.
    if (REDUCED.matches || document.hidden) {
      this.nodes[forward ? 'B' : 'A'] = 1;
      this.render();
      this.start();
      return;
    }
    this.packets.push({
      dir: forward ? 1 : -1,
      t: 0,
      step: 1000 / (60 * 900),
      label: label.slice(0, 6),
    });
    this.nodes[forward ? 'A' : 'B'] = 1;
    this.stage.classList.add('active');
    this.start();
  }

  start() {
    if (this.running || document.hidden) return;
    this.running = true;
    requestAnimationFrame(this.tick);
  }

  tick() {
    if (document.hidden) {
      // Land everything in flight rather than leaving it frozen mid-path.
      for (const p of this.packets) this.nodes[p.dir === 1 ? 'B' : 'A'] = 1;
      this.packets.length = 0;
      this.running = false;
      this.render();
      return;
    }
    this.phase += 0.02;

    for (let i = this.packets.length - 1; i >= 0; i -= 1) {
      const p = this.packets[i];
      if (!p) continue;
      p.t += p.step;
      if (p.t >= 1) {
        this.packets.splice(i, 1);
        this.nodes[p.dir === 1 ? 'B' : 'A'] = 1;
      }
    }
    this.nodes.A = Math.max(0, this.nodes.A - 0.012);
    this.nodes.B = Math.max(0, this.nodes.B - 0.012);

    this.render();

    // The stop condition: nothing in flight, nothing still glowing.
    if (!this.busy()) {
      this.running = false;
      this.stage.classList.remove('active');
      this.render();
      return;
    }
    requestAnimationFrame(this.tick);
  }

  render() {
    const ctx = this.ctx;
    if (!ctx) return;
    const { width, height } = this.canvas.getBoundingClientRect();
    const midY = height / 2;
    const ax = 30;
    const bx = width - 30;
    const span = bx - ax;

    ctx.clearRect(0, 0, width, height);
    if (span <= 0) return;

    // ── the path ────────────────────────────────────────────────────────
    // Cyan at A, violet at B, magenta where they meet: the only place the two
    // systems touch is the only place that colour appears.
    const base = this.linked ? 0.34 : 0.14;
    const path = ctx.createLinearGradient(ax, 0, bx, 0);
    path.addColorStop(0, rgba(CYAN, base));
    path.addColorStop(0.5, rgba(MAGENTA, base * 0.8));
    path.addColorStop(1, rgba(VIOLET, base));
    ctx.strokeStyle = path;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(ax, midY);
    ctx.lineTo(bx, midY);
    ctx.stroke();

    // ── travelling packets ──────────────────────────────────────────────
    for (const p of this.packets) {
      const eased = p.t < 0.5 ? 2 * p.t * p.t : 1 - ((-2 * p.t + 2) ** 2) / 2;
      const x = p.dir === 1 ? ax + span * eased : bx - span * eased;
      const tone = p.dir === 1 ? CYAN : VIOLET;

      const trail = ctx.createLinearGradient(x - p.dir * 60, midY, x, midY);
      trail.addColorStop(0, rgba(tone, 0));
      trail.addColorStop(1, rgba(tone, 0.6));
      ctx.strokeStyle = trail;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x - p.dir * 60, midY);
      ctx.lineTo(x, midY);
      ctx.stroke();

      ctx.save();
      ctx.shadowColor = rgba(tone, 0.9);
      ctx.shadowBlur = 18;
      ctx.fillStyle = rgba(tone, 0.96);
      const w = 34;
      const h = 12;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x - w / 2, midY - h / 2, w, h, 2);
      else ctx.rect(x - w / 2, midY - h / 2, w, h);
      ctx.fill();
      ctx.restore();

      ctx.fillStyle = 'rgba(5,7,13,.95)';
      ctx.font = '600 7px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.label, x, midY + 0.5);
    }

    // ── nodes ───────────────────────────────────────────────────────────
    this.node(ctx, ax, midY, CYAN, this.nodes.A, 'A');
    this.node(ctx, bx, midY, VIOLET, this.nodes.B, 'B');
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} x @param {number} y
   * @param {number[]} tone @param {number} heat @param {string} label
   */
  node(ctx, x, y, tone, heat, label) {
    const alive = this.linked ? 0.5 : 0.22;

    if (heat > 0.01) {
      ctx.beginPath();
      ctx.strokeStyle = rgba(tone, heat * 0.5);
      ctx.lineWidth = 1;
      ctx.arc(x, y, 9 + (1 - heat) * 26, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.save();
    if (heat > 0.01) {
      ctx.shadowColor = rgba(tone, heat);
      ctx.shadowBlur = 20 * heat;
    }
    ctx.beginPath();
    ctx.fillStyle = rgba(tone, alive + heat * 0.5);
    ctx.arc(x, y, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.beginPath();
    ctx.strokeStyle = rgba(tone, alive * 0.5);
    ctx.lineWidth = 1;
    ctx.arc(x, y, 10, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = rgba(tone, 0.85);
    ctx.font = '600 9px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x, y - 24);
  }
}

/**
 * A per-agent activity meter. Bars scale; nothing is ever resized.
 */
export class ActivityMeter {
  /** @param {HTMLElement} host @param {number} [bars] */
  constructor(host, bars = 14) {
    this.host = host;
    /** @type {HTMLElement[]} */
    this.bars = [];
    for (let i = 0; i < bars; i += 1) {
      const bar = document.createElement('b');
      host.append(bar);
      this.bars.push(bar);
    }
    this.energy = 0;
    this.phase = 0;
    this.running = false;
    this.tick = this.tick.bind(this);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.energy > 0) this.start();
    });
  }

  /** @param {number} amount */
  pulse(amount = 0.6) {
    this.energy = Math.min(1, this.energy + amount);
    this.start();
  }

  start() {
    if (this.running || document.hidden || REDUCED.matches) return;
    this.running = true;
    this.host.classList.add('live');
    requestAnimationFrame(this.tick);
  }

  rest() {
    for (const bar of this.bars) bar.style.transform = 'scaleY(.12)';
    this.host.classList.remove('live');
  }

  tick() {
    if (document.hidden) {
      this.running = false;
      return;
    }
    this.phase += 0.25;
    this.energy = Math.max(0, this.energy - 0.014);

    if (this.energy <= 0) {
      this.running = false;
      this.rest();
      return;
    }

    const e = this.energy;
    this.bars.forEach((bar, i) => {
      const n = i / this.bars.length;
      const wave = Math.abs(Math.sin(this.phase + n * 5.2));
      const v = 0.12 + wave * e * 0.88;
      bar.style.transform = `scaleY(${v.toFixed(3)})`;
    });
    requestAnimationFrame(this.tick);
  }
}
