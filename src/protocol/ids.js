/**
 * Message identifiers.
 *
 * Short, zero-padded and monotonic — readable on a projector (ID=001,
 * REPLY=001) and unique for the lifetime of a server process.
 */

import { ID_RE } from './schema.js';

export class IdSequence {
  /** @param {number} [start] */
  constructor(start = 1) {
    /** @type {number} */
    this.value = start;
  }

  /** @returns {string} e.g. "001", "002", ... */
  next() {
    const id = String(this.value).padStart(3, '0');
    this.value += 1;
    if (this.value > 999999) this.value = 1;
    return id;
  }

  /** @param {number} [start] */
  reset(start = 1) {
    this.value = start;
  }
}

/**
 * @param {unknown} id
 * @returns {boolean}
 */
export function isValidId(id) {
  return typeof id === 'string' && ID_RE.test(id);
}
