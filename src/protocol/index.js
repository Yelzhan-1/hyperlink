/**
 * HYPERLINK protocol — public surface.
 *
 * Imported unchanged by the Node server and by the browser, so the packets you
 * see rendered in the UI are decoded by the same code that guards the wire.
 */

export { ProtocolError, isProtocolError } from './errors.js';
export {
  HL_VERSION,
  INTENTS,
  LIMITS,
  MESSAGE_TYPES,
  DATE_KEYWORDS,
  TIME_KEYWORDS,
  knownIntents,
  paramSetFor,
} from './schema.js';
export { encodeFrame } from './encoder.js';
export { decodeFrame, isValidFrame, looksLikeFrame } from './decoder.js';
export { IdSequence, isValidId } from './ids.js';
export { assertNotNaturalLanguage } from './validate.js';
