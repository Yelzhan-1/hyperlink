/**
 * HYPERLINK audio engine.
 *
 * Every sound is synthesised in the browser with the Web Audio API — no files,
 * no samples, nothing copyrighted. The palette is deliberately machine-like:
 * FM-ish carriers, fast exponential decays, and a two-tone "handshake" motif
 * that inverts depending on which direction the packet is travelling.
 *
 * The sound is an audio representation of the protocol. It never carries data —
 * the real communication is the WebSocket underneath.
 */

/** @typedef {'txStart'|'txProgress'|'rx'|'txBack'|'error'|'link'|'reject'} SoundName */

export class AudioEngine {
  constructor() {
    /** @type {AudioContext | null} */
    this.ctx = null;
    /** @type {GainNode | null} */
    this.master = null;
    /** @type {ConvolverNode | null} */
    this.space = null;
    /** @type {boolean} */
    this.enabled = false;
    /** @type {number | null} */
    this.progressTimer = null;
  }

  /**
   * Browsers only allow audio after a gesture, so this is called from the
   * SOUND toggle and nowhere else.
   * @returns {boolean} whether sound is now on
   */
  toggle() {
    if (this.enabled) {
      this.stopProgress();
      this.enabled = false;
      if (this.master) this.master.gain.setTargetAtTime(0, this.now, 0.02);
      return false;
    }
    this.ensureContext();
    this.enabled = true;
    if (this.master) this.master.gain.setTargetAtTime(0.9, this.now, 0.05);
    this.play('link');
    return true;
  }

  ensureContext() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext
      ?? /** @type {any} */ (window).webkitAudioContext;
    const ctx = /** @type {AudioContext} */ (new Ctor());
    this.ctx = ctx;

    const master = ctx.createGain();
    master.gain.value = 0.9;

    // A short synthetic impulse response gives the packets a sense of distance
    // — the two agents sound like they are in different rooms.
    const convolver = ctx.createConvolver();
    const seconds = 1.1;
    const length = Math.floor(ctx.sampleRate * seconds);
    const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let channel = 0; channel < 2; channel += 1) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < length; i += 1) {
        const decay = (1 - i / length) ** 3.2;
        data[i] = (Math.random() * 2 - 1) * decay * 0.55;
      }
    }
    convolver.buffer = impulse;

    const wet = ctx.createGain();
    wet.gain.value = 0.22;
    convolver.connect(wet);
    wet.connect(master);
    master.connect(ctx.destination);

    this.master = master;
    this.space = convolver;
  }

  /** @returns {number} */
  get now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  /**
   * One synth voice.
   * @param {object} opts
   * @param {OscillatorType} [opts.type]
   * @param {number} opts.freq
   * @param {number} [opts.toFreq] glide target
   * @param {number} [opts.at] offset from now, seconds
   * @param {number} [opts.dur]
   * @param {number} [opts.gain]
   * @param {number} [opts.detune]
   * @param {number} [opts.send] reverb amount 0..1
   * @param {{freq: number, depth: number}} [opts.fm]
   */
  voice(opts) {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;

    const at = this.now + (opts.at ?? 0);
    const dur = opts.dur ?? 0.18;
    const osc = ctx.createOscillator();
    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(opts.freq, at);
    if (opts.toFreq !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.toFreq), at + dur);
    }
    if (opts.detune) osc.detune.setValueAtTime(opts.detune, at);

    // Optional FM operator — this is what makes it read as "machine" and not
    // "chime".
    if (opts.fm) {
      const mod = ctx.createOscillator();
      const modGain = ctx.createGain();
      mod.frequency.setValueAtTime(opts.fm.freq, at);
      modGain.gain.setValueAtTime(opts.fm.depth, at);
      mod.connect(modGain);
      modGain.connect(osc.frequency);
      mod.start(at);
      mod.stop(at + dur + 0.05);
    }

    const gain = ctx.createGain();
    const peak = opts.gain ?? 0.18;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(peak, at + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);

    osc.connect(gain);
    gain.connect(master);
    if (this.space && opts.send) {
      const sendGain = ctx.createGain();
      sendGain.gain.value = opts.send;
      gain.connect(sendGain);
      sendGain.connect(this.space);
    }

    osc.start(at);
    osc.stop(at + dur + 0.05);
  }

  /**
   * Filtered noise burst — the "data" texture.
   * @param {{at?: number, dur?: number, gain?: number, freq?: number, q?: number, sweep?: number}} opts
   */
  noise(opts = {}) {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;

    const at = this.now + (opts.at ?? 0);
    const dur = opts.dur ?? 0.12;
    const frames = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i += 1) data[i] = Math.random() * 2 - 1;

    const src = ctx.createBufferSource();
    src.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(opts.freq ?? 1400, at);
    if (opts.sweep) {
      filter.frequency.exponentialRampToValueAtTime(Math.max(60, opts.sweep), at + dur);
    }
    filter.Q.value = opts.q ?? 6;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(opts.gain ?? 0.1, at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    if (this.space) {
      const sendGain = ctx.createGain();
      sendGain.gain.value = 0.35;
      gain.connect(sendGain);
      sendGain.connect(this.space);
    }
    src.start(at);
    src.stop(at + dur + 0.02);
  }

  /**
   * @param {SoundName} name
   */
  play(name) {
    if (!this.enabled || !this.ctx) return;
    if (this.ctx.state === 'suspended') void this.ctx.resume();

    switch (name) {
      // A rising interrogative pair: "I am about to speak machine."
      case 'txStart':
        this.voice({ type: 'triangle', freq: 420, toFreq: 1180, dur: 0.16, gain: 0.16, send: 0.4, fm: { freq: 90, depth: 130 } });
        this.voice({ type: 'square', freq: 1180, dur: 0.05, gain: 0.05, at: 0.14, detune: 8 });
        this.noise({ at: 0.02, dur: 0.14, freq: 2600, sweep: 900, gain: 0.06 });
        break;

      // Ticking data texture while a packet is in flight.
      case 'txProgress':
        this.voice({ type: 'square', freq: 2100 + Math.random() * 700, dur: 0.028, gain: 0.035, detune: Math.random() * 40 });
        this.noise({ dur: 0.035, freq: 3200, q: 12, gain: 0.03 });
        break;

      // Arrival: a downward pair, the mirror of txStart.
      case 'rx':
        this.voice({ type: 'triangle', freq: 1180, toFreq: 520, dur: 0.18, gain: 0.15, send: 0.5, fm: { freq: 140, depth: 90 } });
        this.voice({ type: 'sine', freq: 260, dur: 0.22, gain: 0.09, at: 0.05, send: 0.6 });
        this.noise({ dur: 0.1, freq: 800, sweep: 240, gain: 0.05 });
        break;

      // The answer heading home — same motif, transposed up a fifth.
      case 'txBack':
        this.voice({ type: 'triangle', freq: 640, toFreq: 1560, dur: 0.15, gain: 0.15, send: 0.4, fm: { freq: 110, depth: 150 } });
        this.voice({ type: 'sine', freq: 1560, dur: 0.12, gain: 0.07, at: 0.12, send: 0.5 });
        this.noise({ at: 0.01, dur: 0.12, freq: 3000, sweep: 1200, gain: 0.05 });
        break;

      // Handshake / link established — a clean perfect fifth.
      case 'link':
        this.voice({ type: 'sine', freq: 660, dur: 0.5, gain: 0.09, send: 0.7 });
        this.voice({ type: 'sine', freq: 990, dur: 0.42, gain: 0.06, at: 0.08, send: 0.7 });
        break;

      // Rejection: a dissonant, deliberately unpleasant minor second.
      case 'reject':
      case 'error':
        this.voice({ type: 'sawtooth', freq: 220, toFreq: 90, dur: 0.34, gain: 0.13, send: 0.3 });
        this.voice({ type: 'square', freq: 233, toFreq: 96, dur: 0.32, gain: 0.08, at: 0.01 });
        this.noise({ dur: 0.3, freq: 600, sweep: 160, gain: 0.07, q: 3 });
        break;

      default:
        break;
    }
  }

  /** Start the in-flight ticking. */
  startProgress() {
    if (!this.enabled || this.progressTimer !== null) return;
    this.progressTimer = window.setInterval(() => this.play('txProgress'), 95);
  }

  stopProgress() {
    if (this.progressTimer !== null) {
      window.clearInterval(this.progressTimer);
      this.progressTimer = null;
    }
  }

  /**
   * A short burst of ticking, matched to a transmission animation.
   * @param {number} ms
   */
  burst(ms) {
    if (!this.enabled) return;
    this.startProgress();
    window.setTimeout(() => this.stopProgress(), ms);
  }
}
