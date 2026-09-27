/**
 * Phase 0 status catalog and the transitions an agent may write (protocol.md §1.1). Humans may write any transition
 * between catalog keys.
 */
import type {
  BuiltInStatusKey,
  StatusCatalogEntry,
  StatusCategory,
  StatusTransition,
} from '../shared/protocol.js';

export const AGENT_TRANSITIONS: readonly StatusTransition[] = [
  { from: 'todo', to: 'in_progress' },
  { from: 'blocked', to: 'in_progress' },
  { from: 'in_progress', to: 'in_review' },
  { from: 'in_progress', to: 'blocked' },
];

const CATEGORIES: Readonly<Record<BuiltInStatusKey, StatusCategory>> = {
  backlog: 'unstarted',
  todo: 'unstarted',
  in_progress: 'started',
  in_review: 'started',
  blocked: 'started',
  done: 'done',
  cancelled: 'closed',
};

const AGENT_WRITABLE = new Set(
  AGENT_TRANSITIONS.map((transition) => transition.to),
);

export const STATUS_CATALOG: readonly StatusCatalogEntry[] = (
  Object.keys(CATEGORIES) as BuiltInStatusKey[]
).map((key) => ({
  key,
  category: CATEGORIES[key],
  agentWritable: AGENT_WRITABLE.has(key),
}));

export const DEFAULT_STATUS: BuiltInStatusKey = 'todo';

export function isKnownStatus(key: string): key is BuiltInStatusKey {
  return Object.hasOwn(CATEGORIES, key);
}

/** done | cancelled */
export function isTerminalStatus(key: string): boolean {
  return key === 'done' || key === 'cancelled';
}

/** Statuses in which assigning an agent does not start work: backlog, done, cancelled. */
export function isDormantStatus(key: string): boolean {
  return key === 'backlog' || isTerminalStatus(key);
}

export function isAgentTransitionAllowed(from: string, to: string): boolean {
  return AGENT_TRANSITIONS.some(
    (transition) => transition.from === from && transition.to === to,
  );
}
