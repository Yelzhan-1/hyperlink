/**
 * Ollama backend — the default AI for HYPERLINK.
 *
 * Talks to a local Ollama daemon over its HTTP API. Nothing about the model is
 * baked in: base URL and model name arrive from configuration, so pointing the
 * platform at a different model is an env change, not a code change.
 */

/** @typedef {{role:'system'|'user'|'assistant', content:string}} ChatMessage */

/**
 * @typedef {object} OllamaConfig
 * @property {string} baseUrl
 * @property {string} model
 * @property {number} timeoutMs
 */

export class OllamaBackend {
  /** @param {OllamaConfig} config */
  constructor(config) {
    /** @type {string} */
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    /** @type {string} */
    this.model = config.model;
    /** @type {number} */
    this.timeoutMs = config.timeoutMs;
    /** @type {string} */
    this.name = 'ollama';
  }

  /** @returns {string} what the UI shows in the AI badge */
  get label() {
    return `OLLAMA:${this.model}`;
  }

  /**
   * Is the daemon up, and does it have the configured model?
   * @returns {Promise<{ok: boolean, reason?: string, models?: string[]}>}
   */
  async health() {
    try {
      const res = await this.request('/api/tags', undefined, 4000);
      if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
      const body = /** @type {{models?: {name: string}[]}} */ (await res.json());
      const models = (body.models ?? []).map((m) => m.name);
      const has = models.some((m) => m === this.model || m.split(':')[0] === this.model);
      if (!has) return { ok: false, reason: `model "${this.model}" not pulled`, models };
      return { ok: true, models };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * One chat completion.
   * @param {{system: string, user: string, json?: boolean}} opts
   * @returns {Promise<string>} raw assistant text
   */
  async chat({ system, user, json = false }) {
    const res = await this.request('/api/chat', {
      model: this.model,
      stream: false,
      ...(json ? { format: 'json' } : {}),
      messages: /** @type {ChatMessage[]} */ ([
        { role: 'system', content: system },
        { role: 'user', content: user },
      ]),
      options: {
        // Determinism matters more than flair when the output feeds a strict
        // encoder and a live demo.
        temperature: 0,
        top_p: 0.9,
        seed: 17,
        num_predict: json ? 256 : 160,
      },
    });

    if (!res.ok) {
      throw new Error(`ollama ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    const body = /** @type {{message?: {content?: string}}} */ (await res.json());
    const content = body.message?.content;
    if (typeof content !== 'string' || content.trim() === '') {
      throw new Error('ollama returned an empty completion');
    }
    return content.trim();
  }

  /**
   * @param {string} path
   * @param {unknown} [payload]
   * @param {number} [timeoutMs]
   * @returns {Promise<Response>}
   */
  async request(path, payload, timeoutMs = this.timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(`${this.baseUrl}${path}`, {
        method: payload === undefined ? 'GET' : 'POST',
        headers: payload === undefined ? {} : { 'content-type': 'application/json' },
        body: payload === undefined ? undefined : JSON.stringify(payload),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}
