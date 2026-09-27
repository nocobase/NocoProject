import type {
  AgentListItem,
  IssuePriority,
  RunStatus,
  StatusCatalogEntry,
  StatusCategory,
} from './types.js';

/**
 * The Phase 0 status catalog (protocol §1.1). The issue detail returns the authoritative catalog; this copy covers
 * the list page, whose endpoint does not return one, and the create form.
 */
export const DEFAULT_STATUS_CATALOG: readonly StatusCatalogEntry[] = [
  { key: 'backlog', category: 'unstarted', agentWritable: false },
  { key: 'todo', category: 'unstarted', agentWritable: false },
  { key: 'in_progress', category: 'started', agentWritable: true },
  { key: 'in_review', category: 'started', agentWritable: true },
  { key: 'blocked', category: 'started', agentWritable: true },
  { key: 'done', category: 'done', agentWritable: false },
  { key: 'cancelled', category: 'closed', agentWritable: false },
];

/** Locale keys under `np.status.*` are the status keys with the underscore removed (`in_progress` → `inProgress`). */
export function statusLabelKey(statusKey: string): string {
  return `np.status.${statusKey.replace(/_([a-z])/gu, (_, letter: string) => letter.toUpperCase())}`;
}

export const KNOWN_STATUS_KEYS: ReadonlySet<string> = new Set(
  DEFAULT_STATUS_CATALOG.map((entry) => entry.key),
);

export function statusCategory(
  statusKey: string,
  catalog: readonly StatusCatalogEntry[] = DEFAULT_STATUS_CATALOG,
): StatusCategory {
  return (
    catalog.find((entry) => entry.key === statusKey)?.category ??
    DEFAULT_STATUS_CATALOG.find((entry) => entry.key === statusKey)?.category ??
    'unstarted'
  );
}

export type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline';

/** Status category → Badge variant. Semantic variants only, so both themes follow the tokens. */
export const CATEGORY_BADGE: Readonly<Record<StatusCategory, BadgeVariant>> = {
  unstarted: 'outline',
  started: 'secondary',
  done: 'default',
  closed: 'outline',
};

export const ISSUE_PRIORITIES: readonly IssuePriority[] = [
  'urgent',
  'high',
  'medium',
  'low',
  'none',
];

export const RUN_BADGE: Readonly<Record<RunStatus, BadgeVariant>> = {
  queued: 'outline',
  deferred: 'outline',
  dispatched: 'secondary',
  running: 'secondary',
  completed: 'default',
  failed: 'destructive',
  cancelled: 'outline',
};

export const ACTIVE_RUN_STATUSES: ReadonlySet<RunStatus> = new Set([
  'queued',
  'deferred',
  'dispatched',
  'running',
]);

export const CANCELLABLE_RUN_STATUSES: ReadonlySet<RunStatus> = new Set([
  'queued',
  'deferred',
  'dispatched',
  'running',
]);

export const RETRYABLE_RUN_STATUSES: ReadonlySet<RunStatus> = new Set([
  'failed',
  'cancelled',
]);

export function isRuntimeOnline(agent: AgentListItem): boolean {
  if (typeof agent.runtimeOnline === 'boolean') return agent.runtimeOnline;
  return agent.runtimeStatus === 'online';
}

/** TanStack Query keys. Everything starts with `np` so a reconnect can invalidate the whole family. */
export const npKeys = {
  all: ['np'] as const,
  me: ['np', 'me'] as const,
  projects: ['np', 'projects'] as const,
  issues: ['np', 'issues'] as const,
  issueList: (filters: { readonly statusKey?: string; readonly q?: string }) =>
    ['np', 'issues', filters] as const,
  issue: (id: string) => ['np', 'issue', id] as const,
  agents: ['np', 'agents'] as const,
  runtimes: ['np', 'runtimes'] as const,
  run: (id: string) => ['np', 'run', id] as const,
};
