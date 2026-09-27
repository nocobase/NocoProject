import { ZodError } from 'zod';
import { HttpError, NetworkError } from '../api/client.js';
import { redactText } from '../util/redact.js';

export const EXIT = { ok: 0, other: 1, network: 2, auth: 3, notFound: 4, validation: 5 } as const;

export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode: number = EXIT.other,
    readonly code = 'CLI_ERROR',
  ) {
    super(message);
    this.name = 'CliError';
  }
}

export function exitCodeFor(error: unknown): number {
  if (error instanceof CliError) return error.exitCode;
  if (error instanceof NetworkError) return EXIT.network;
  if (error instanceof ZodError) return EXIT.validation;
  if (error instanceof HttpError) {
    if (error.code === 'TRANSITION_NOT_ALLOWED' || error.code === 'DESIGN_NOT_APPROVED') return EXIT.validation;
    if (error.status === 401 || error.status === 403) return EXIT.auth;
    if (error.status === 404) return EXIT.notFound;
    if (error.status === 400 || error.status === 409 || error.status === 422) return EXIT.validation;
  }
  return EXIT.other;
}

function errorCode(error: unknown): string {
  if (error instanceof CliError) return error.code;
  if (error instanceof HttpError) return error.code;
  if (error instanceof NetworkError) return 'NETWORK_ERROR';
  if (error instanceof ZodError) return 'VALIDATION_ERROR';
  return 'ERROR';
}

function errorMessage(error: unknown): string {
  if (error instanceof ZodError) return error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ');
  return error instanceof Error ? error.message : String(error);
}

/** Prints an error (JSON on stdout with --json, text on stderr otherwise) and exits. */
export function failAndExit(error: unknown, json: boolean): never {
  const code = exitCodeFor(error);
  const message = redactText(errorMessage(error));
  if (json) process.stdout.write(`${JSON.stringify({ error: { code: errorCode(error), message, exitCode: code } })}\n`);
  else process.stderr.write(`error: ${message}\n`);
  process.exit(code);
}

export function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function printLine(text = ''): void {
  process.stdout.write(`${text}\n`);
}
