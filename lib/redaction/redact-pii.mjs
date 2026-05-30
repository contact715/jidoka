// PII redaction utilities — shared by emit-telemetry.mjs (write-time masking so raw
// PII never reaches a telemetry stream) and validate-gdpr-inventory.mjs (scanning
// audit streams for leaked PII). This module was referenced by 31 engine scripts
// via emit-telemetry but did not exist on disk, so every one of them crashed with
// ERR_MODULE_NOT_FOUND at import time. Creating it is the single highest-leverage
// instantiation fix — it brings the telemetry layer (and its 31 consumers) to life.
//
// API (as consumed by the callers):
//   detectPiiTokens(str) -> Array<{ type, value }>   matches found ([] if clean; .length is checked)
//   redactPiiString(str) -> string                   same string with every match masked
//
// Detects the PII classes the framework already guards elsewhere (pre-publish-guard
// RULES): home paths, emails, and credential tokens. Conservative by design — it
// masks rather than drops, so redacted telemetry stays structurally intact.

const PATTERNS = [
  { type: 'home-path',    source: '(?:/Users/|/home/)[A-Za-z0-9._-]+',            mask: '[path]' },
  { type: 'email',        source: '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}', mask: '[email]' },
  { type: 'github-token', source: 'gh[posru]_[A-Za-z0-9]{20,}',                  mask: '[token]' },
  { type: 'openai-key',   source: 'sk-[A-Za-z0-9]{20,}',                         mask: '[token]' },
  { type: 'aws-key',      source: 'AKIA[A-Z0-9]{16}',                            mask: '[token]' },
  { type: 'private-key',  source: '-----BEGIN [A-Z ]*PRIVATE KEY-----',          mask: '[private-key]' },
];

/**
 * Find every PII token in a string.
 * @param {unknown} input
 * @returns {Array<{ type: string, value: string }>}
 */
export function detectPiiTokens(input) {
  if (typeof input !== 'string') return [];
  const found = [];
  for (const { type, source } of PATTERNS) {
    const matches = input.match(new RegExp(source, 'g'));
    if (matches) for (const value of matches) found.push({ type, value });
  }
  return found;
}

/**
 * Mask every PII token in a string. Non-strings pass through unchanged.
 * @param {unknown} input
 * @returns {unknown}
 */
export function redactPiiString(input) {
  if (typeof input !== 'string') return input;
  let out = input;
  for (const { source, mask } of PATTERNS) {
    out = out.replace(new RegExp(source, 'g'), mask);
  }
  return out;
}
