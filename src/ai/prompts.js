/**
 * System prompts.
 *
 * Three jobs, three prompts:
 *   understand — human sentence   → structured intent JSON  (Agent A)
 *   resolve    — structured task  → structured result JSON  (Agent B)
 *   verbalize  — structured result → one human sentence      (Agent A)
 *
 * The model is never asked to write a HYPERLINK frame. It emits JSON; the
 * encoder builds the frame. That boundary is the whole security model.
 */

import { DATE_KEYWORDS, INTENTS, TIME_KEYWORDS } from '../protocol/schema.js';

/**
 * Render the intent registry as a compact contract the model can follow.
 * @param {'task'|'result'} side
 * @returns {string}
 */
export function intentCatalog(side) {
  return Object.entries(INTENTS)
    .map(([name, spec]) => {
      const params = Object.entries(spec[side])
        .map(([key, ps]) => {
          const t = ps.type;
          let shape;
          switch (t.kind) {
            case 'ENUM': shape = t.values.join('|'); break;
            case 'INT': shape = `int ${t.min}..${t.max}`; break;
            case 'DATE': shape = 'TODAY|TOMORROW|YYYY-MM-DD'; break;
            case 'TIME': shape = 'HHMM|MORNING|AFTERNOON|EVENING|NIGHT'; break;
            case 'BOOL': shape = 'TRUE|FALSE'; break;
            default: shape = 'UPPERCASE_TOKEN';
          }
          return `${key}${ps.required ? '*' : ''}:${shape}`;
        })
        .join(', ');
      return `- ${name} { ${params} }`;
    })
    .join('\n');
}

export const UNDERSTAND_SYSTEM = `You are the reasoning core of HYPERLINK Agent A.

A human speaks to you in ordinary language, in any language (English, Russian, Kazakh).
Your only job is to convert that request into ONE structured intent object.

Reply with RAW JSON ONLY. No prose, no markdown, no code fences.

Shape:
{"intent":"<INTENT_NAME>","params":{"KEY":"VALUE"},"confidence":0.0-1.0}

Available intents and their parameters (* = required):
${intentCatalog('task')}

Hard rules:
- Choose exactly one intent from the list. If nothing fits, use {"intent":"UNKNOWN","params":{}}.
- Every value must be a machine token: UPPERCASE A-Z 0-9 _ . : + - only.
- Never put a sentence, a question, spaces, punctuation or non-Latin script in a value.
- Numbers are plain digits ("four" -> 4, "пять" -> 5).
- Place names are transliterated and uppercased ("Алматы" -> ALMATY, "New York" -> NEW_YORK).
- Dates: ${DATE_KEYWORDS.join('|')} or YYYY-MM-DD.
- Times: 24h HHMM (7 PM -> 1900) or ${TIME_KEYWORDS.join('|')}.
- Omit a parameter you were not told, rather than inventing it.`;

export const RESOLVE_SYSTEM = `You are the reasoning core of HYPERLINK Agent B.

You never speak to humans. You receive a decoded machine task from a peer agent
plus authoritative data from your service backend, and you decide the structured
result.

Reply with RAW JSON ONLY. No prose, no markdown, no code fences.

Shape:
{"params":{"KEY":"VALUE"}}

Result parameters per intent (* = required):
${intentCatalog('result')}

Hard rules:
- The backend facts are authoritative. Do not contradict them or invent values.
- Every value must be a machine token: UPPERCASE A-Z 0-9 _ . : + - only.
- Include every required parameter for the intent.
- Never include explanations.`;

export const VERBALIZE_SYSTEM = `You are the voice of HYPERLINK Agent A, speaking to the human who made the request.

You are given the original request and the structured result that the peer agent
returned over the machine protocol. Turn it into ONE short, natural, friendly
sentence — two at most.

Rules:
- Reply in the same language the human used.
- Never show protocol syntax, parameter names, IDs or JSON to the human.
- State the concrete answer (time, venue, temperature, price) plainly.
- No preamble, no "as an AI", no bullet points.`;

/**
 * @param {string} humanText
 * @returns {string}
 */
export function understandUser(humanText) {
  return `Human request:\n"""${humanText}"""\n\nJSON:`;
}

/**
 * @param {{intent: string, params: Record<string, string>, facts: Record<string, unknown>, suggested: Record<string, string|number>}} input
 * @returns {string}
 */
export function resolveUser(input) {
  return [
    `Incoming task intent: ${input.intent}`,
    `Task parameters: ${JSON.stringify(input.params)}`,
    `Backend facts: ${JSON.stringify(input.facts)}`,
    `Backend proposed result: ${JSON.stringify(input.suggested)}`,
    '',
    'JSON:',
  ].join('\n');
}

/**
 * @param {{humanText: string, intent: string, params: Record<string, string>}} input
 * @returns {string}
 */
export function verbalizeUser(input) {
  return [
    `The human asked: """${input.humanText}"""`,
    `Peer agent answered (${input.intent}): ${JSON.stringify(input.params)}`,
    '',
    'Your sentence:',
  ].join('\n');
}
