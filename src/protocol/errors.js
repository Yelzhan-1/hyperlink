/**
 * Protocol-level failures. Every rejection carries a stable machine code so the
 * UI and the transport can react without string-matching messages.
 */

/** @typedef {'E_SYNTAX'|'E_VERSION'|'E_TYPE'|'E_INTENT'|'E_ID'|'E_REPLY'|'E_DUP_KEY'|'E_PARAM_KEY'|'E_PARAM_VALUE'|'E_REQUIRED'|'E_LENGTH'|'E_TOO_MANY_PARAMS'|'E_NL_DETECTED'|'E_NOT_A_FRAME'} ProtocolErrorCode */

export class ProtocolError extends Error {
  /**
   * @param {ProtocolErrorCode} code
   * @param {string} message
   * @param {Record<string, unknown>} [detail]
   */
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'ProtocolError';
    /** @type {ProtocolErrorCode} */
    this.code = code;
    /** @type {Record<string, unknown>} */
    this.detail = detail;
  }

  /** Serialisable shape for the wire / UI. */
  toJSON() {
    return { code: this.code, message: this.message, detail: this.detail };
  }
}

/**
 * @param {unknown} err
 * @returns {err is ProtocolError}
 */
export function isProtocolError(err) {
  return err instanceof ProtocolError;
}
