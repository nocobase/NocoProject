/**
 * Secret redaction for agent output, logs and error details.
 *
 * Everything that leaves this machine (run events, failure details) or lands in a
 * log file goes through `redactText` / `redactValue` first.
 */

interface SecretPattern {
  readonly re: RegExp;
  readonly replacement: string;
}

const PATTERNS: readonly SecretPattern[] = [
  { re: /-----BEGIN[A-Z ]*PRIVATE KEY-----[\s\S]*?-----END[A-Z ]*PRIVATE KEY-----/g, replacement: '[REDACTED PRIVATE KEY]' },
  { re: /\bAKIA[0-9A-Z]{16}\b/g, replacement: '[REDACTED AWS KEY]' },
  {
    re: /(aws_secret_access_key|secret_?access_?key)(\s*[=:]\s*)[A-Za-z0-9/+=]{40}/gi,
    replacement: '$1$2[REDACTED AWS SECRET]',
  },
  { re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,255}\b/g, replacement: '[REDACTED GITHUB TOKEN]' },
  { re: /\bgithub_pat_[A-Za-z0-9_]{20,255}\b/g, replacement: '[REDACTED GITHUB TOKEN]' },
  { re: /\bnpr_[A-Fa-f0-9]{16,}\b/g, replacement: '[REDACTED RUN TOKEN]' },
  { re: /\bsk-[A-Za-z0-9_.\-]{16,}/g, replacement: '[REDACTED API KEY]' },
  { re: /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi, replacement: 'Bearer [REDACTED]' },
  { re: /(x-api-key["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, replacement: '$1[REDACTED]' },
];

/** Values registered at runtime (the daemon API key, issued run tokens) are always masked. */
const knownSecrets = new Set<string>();

export function registerSecret(value: string | undefined | null): void {
  if (value && value.length >= 8) knownSecrets.add(value);
}

export function forgetSecret(value: string | undefined | null): void {
  if (value) knownSecrets.delete(value);
}

export function redactText(input: string): string {
  let out = input;
  for (const secret of knownSecrets) {
    if (out.includes(secret)) out = out.split(secret).join('[REDACTED]');
  }
  for (const p of PATTERNS) out = out.replace(p.re, p.replacement);
  return out;
}

const MAX_DEPTH = 32;

/** Deep-redacts every string inside a JSON-like value; returns a copy. */
export function redactValue(value: unknown, depth = 0): unknown {
  if (depth >= MAX_DEPTH) return '[REDACTED DEPTH LIMIT]';
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.map((v) => redactValue(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = redactValue(v, depth + 1);
    return out;
  }
  return value;
}
