import type {
  CommentThread,
  IssueActivity,
  IssueDetail,
  RunSummary,
} from '../../types.js';

export type TimelineEntry =
  | {
      readonly kind: 'thread';
      readonly key: string;
      readonly at: string;
      readonly thread: CommentThread;
    }
  | {
      readonly kind: 'activity';
      readonly key: string;
      readonly at: string;
      readonly activity: IssueActivity;
    }
  | {
      readonly kind: 'run';
      readonly key: string;
      readonly at: string;
      readonly run: RunSummary;
    };

/**
 * Comments (as threads), activities and run summaries on one chronological line, oldest first. A run sits where it
 * was triggered and describes its current state, so a finished run does not appear twice.
 */
export function buildTimeline(
  detail: Pick<IssueDetail, 'threads' | 'activities' | 'runs'>,
): TimelineEntry[] {
  const entries: TimelineEntry[] = [
    ...detail.threads.map((thread): TimelineEntry => ({
      kind: 'thread',
      key: `thread:${thread.root.id}`,
      at: thread.root.createdAt,
      thread,
    })),
    ...detail.activities.map((activity): TimelineEntry => ({
      kind: 'activity',
      key: `activity:${activity.id}`,
      at: activity.createdAt,
      activity,
    })),
    ...detail.runs.map((run): TimelineEntry => ({
      kind: 'run',
      key: `run:${run.id}`,
      at: run.createdAt,
      run,
    })),
  ];
  return entries.sort(
    (a, b) => a.at.localeCompare(b.at) || a.key.localeCompare(b.key),
  );
}

export type ActivityLabel =
  | 'created'
  | 'statusChanged'
  | 'priorityChanged'
  | 'executorChanged'
  | 'ownerChanged'
  | 'titleChanged'
  | 'descriptionChanged'
  | 'updated';

/**
 * Maps a server activity `action` to a locale label. The Phase 0 action vocabulary is not fixed by the protocol, so
 * the match is by keyword (`status.changed`, `issue.statusChanged`, `status_change` all read as a status change).
 */
export function activityLabel(action: string): ActivityLabel {
  const normalized = action.toLowerCase().replace(/[^a-z]/gu, '');
  if (normalized.includes('status')) return 'statusChanged';
  if (normalized.includes('priority')) return 'priorityChanged';
  if (normalized.includes('executor') || normalized.includes('assign')) {
    return 'executorChanged';
  }
  if (normalized.includes('owner')) return 'ownerChanged';
  if (normalized.includes('title')) return 'titleChanged';
  if (normalized.includes('description')) return 'descriptionChanged';
  if (normalized.includes('create')) return 'created';
  return 'updated';
}

/** Reads `{ from, to }` string details from the loosely shaped activity payload. */
export function activityChange(
  details: Record<string, unknown> | null | undefined,
): { readonly from: string | null; readonly to: string | null } {
  const pick = (...names: string[]): string | null => {
    for (const name of names) {
      const value = details?.[name];
      if (typeof value === 'string' && value) return value;
    }
    return null;
  };
  return {
    from: pick('from', 'fromStatus', 'previous', 'old'),
    to: pick('to', 'toStatus', 'next', 'new'),
  };
}
