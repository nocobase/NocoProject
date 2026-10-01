/**
 * How a failed built-in run is recorded (NP-219, protocol-runtime-types.md §6.7): the AI plugin's `AgentServiceError`
 * code, and for `PROVIDER_ERROR` its `rootMessage`, map onto the failure reasons the daemon already reports, plus
 * `builtinUnavailable` and `agentError.stepLimit`. Whether the reason is retried is decided by `run/failure.ts`.
 */
import type { FailureReason } from '../shared/protocol.js';

export type BuiltinFailure =
  | { readonly kind: 'cancelled' }
  | {
      readonly kind: 'failed';
      readonly reason: string;
      readonly detail: string;
      /** The session must not be resumed (context overflow). */
      readonly poisoned: boolean;
      /** The runtime is marked `check_failed` (§4.2). */
      readonly runtimeFault: boolean;
    };

/** The reasons that say the service itself is unusable. */
const RUNTIME_FAULTS: readonly string[] = [
  'builtinUnavailable',
  'agentError.providerAuth',
  'agentError.providerQuota',
  'agentError.providerServerError',
  'agentError.providerNetwork',
];

const PROVIDER_RULES: readonly [RegExp, FailureReason][] = [
  [
    /\b40[13]\b|invalid[ _-]?api[ _-]?key|unauthori[sz]ed|authentication/iu,
    'agentError.providerAuth',
  ],
  [
    /quota|insufficient[ _-]?(balance|funds|credit)|billing/iu,
    'agentError.providerQuota',
  ],
  [
    /\b429\b|rate[ _-]?limit|too many requests/iu,
    'agentError.providerRateLimit',
  ],
  [
    /ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|fetch failed|network|socket hang up/iu,
    'agentError.providerNetwork',
  ],
  [
    /model[^.]*(not[ _-]?found|does not exist)|unknown model|no such model/iu,
    'agentError.modelUnavailable',
  ],
  [
    /context[ _-]?length|maximum context|context window|too many tokens/iu,
    'agentError.contextOverflow',
  ],
  [
    /\b5\d\d\b|server error|service unavailable|bad gateway/iu,
    'agentError.providerServerError',
  ],
];

interface ErrorLike {
  readonly code?: unknown;
  readonly rootMessage?: unknown;
  readonly message?: unknown;
}

function messageOf(error: unknown): string {
  const value = error as ErrorLike | null;
  const text =
    typeof value?.rootMessage === 'string' && value.rootMessage
      ? value.rootMessage
      : typeof value?.message === 'string'
        ? value.message
        : String(error);
  return text.slice(0, 2000);
}

function failed(reason: string, detail: string): BuiltinFailure {
  return {
    kind: 'failed',
    reason,
    detail,
    poisoned: reason === 'agentError.contextOverflow',
    runtimeFault: RUNTIME_FAULTS.includes(reason),
  };
}

/**
 * The failure a built-in run ended with. `stopped` says why the run's own signal fired, if it did: a cancellation is
 * no failure, a timeout is `timeout`.
 */
export function classifyBuiltinError(
  error: unknown,
  stopped: 'cancel' | 'timeout' | 'shutdown' | null = null,
): BuiltinFailure {
  const code = (error as ErrorLike | null)?.code;
  const detail = messageOf(error);
  if (stopped === 'cancel') return { kind: 'cancelled' };
  if (stopped === 'timeout') return failed('timeout', detail);
  if (stopped === 'shutdown') return failed('runtimeRecovery', detail);
  switch (code) {
    case 'ABORTED':
      // Not by this run's signal: the plugin stopped it (its own controller), so it may run again.
      return failed('runtimeRecovery', detail);
    case 'CONFIGURATION_ERROR':
      return failed('builtinUnavailable', detail);
    case 'GRAPH_RECURSION_ERROR':
      return failed('agentError.stepLimit', detail);
    case 'EMPTY_RESPONSE':
      return failed('agentError.emptyOutput', detail);
    case 'PROVIDER_ERROR': {
      const rule = PROVIDER_RULES.find(([pattern]) => pattern.test(detail));
      return failed(rule ? rule[1] : 'agentError.unknown', detail);
    }
    default:
      return failed('agentError.unknown', detail);
  }
}
