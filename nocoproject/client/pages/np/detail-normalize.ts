import { DEFAULT_STATUS_CATALOG } from './constants.js';
import type {
  CommentThread,
  Issue,
  IssueActivity,
  IssueComment,
  IssueDetail,
  RunSummary,
  StatusCatalogEntry,
} from './types.js';

/**
 * The raw body of `GET /np/issues/:id`. Protocol §3 says "issue + comments(tree) + activities + runs(summary) +
 * statusCatalog" without fixing whether the issue fields sit at the top level or under `issue`, nor whether the tree
 * is nested (`replies` / `children`) or a flat list with `parentId`. Both shapes are accepted.
 */
export interface RawIssueDetail extends Partial<Issue> {
  readonly issue?: Issue;
  readonly comments?: readonly IssueComment[];
  readonly activities?: readonly IssueActivity[];
  readonly runs?: readonly RunSummary[];
  readonly statusCatalog?: readonly StatusCatalogEntry[];
}

function byCreatedAt(
  a: { readonly createdAt: string },
  b: { readonly createdAt: string },
): number {
  return a.createdAt.localeCompare(b.createdAt);
}

/** Flattens a nested or flat comment list into every comment exactly once. */
function flattenComments(comments: readonly IssueComment[]): IssueComment[] {
  const seen = new Map<string, IssueComment>();
  const visit = (comment: IssueComment, parentId: string | null): void => {
    if (!seen.has(comment.id)) {
      seen.set(comment.id, {
        ...comment,
        parentId: comment.parentId ?? parentId,
      });
    }
    for (const child of [
      ...(comment.replies ?? []),
      ...(comment.children ?? []),
    ]) {
      visit(child, comment.id);
    }
  };
  for (const comment of comments) visit(comment, null);
  return [...seen.values()];
}

/**
 * Groups comments into threads: each top-level comment with all of its descendants flattened, oldest first. A
 * reply whose ancestor chain is broken (a parent missing from the payload) becomes a thread of its own rather than
 * disappearing.
 */
export function normalizeComments(
  comments: readonly IssueComment[],
): CommentThread[] {
  const flat = flattenComments(comments);
  const byId = new Map(flat.map((comment) => [comment.id, comment]));
  const rootOf = (comment: IssueComment): IssueComment => {
    let current = comment;
    const visited = new Set<string>();
    while (current.parentId && !visited.has(current.id)) {
      visited.add(current.id);
      const parent = byId.get(current.parentId);
      if (!parent) break;
      current = parent;
    }
    return current;
  };
  const threads = new Map<string, IssueComment[]>();
  const roots = new Map<string, IssueComment>();
  for (const comment of flat) {
    const root = rootOf(comment);
    roots.set(root.id, root);
    if (root.id !== comment.id) {
      threads.set(root.id, [...(threads.get(root.id) ?? []), comment]);
    }
  }
  return [...roots.values()].sort(byCreatedAt).map((root) => ({
    root: { ...root, replies: undefined, children: undefined },
    replies: (threads.get(root.id) ?? [])
      .map((reply) => ({ ...reply, replies: undefined, children: undefined }))
      .sort(byCreatedAt),
  }));
}

export function normalizeIssueDetail(raw: RawIssueDetail): IssueDetail {
  const issue = (raw.issue ?? raw) as Issue;
  return {
    issue,
    threads: normalizeComments(raw.comments ?? []),
    activities: [...(raw.activities ?? [])].sort(byCreatedAt),
    runs: [...(raw.runs ?? [])].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    ),
    statusCatalog:
      raw.statusCatalog && raw.statusCatalog.length > 0
        ? raw.statusCatalog
        : DEFAULT_STATUS_CATALOG,
  };
}

/** The trigger type a run summary carries, from `triggerType` or its first trigger. */
export function runTriggerType(run: RunSummary): string | null {
  return run.triggerType ?? run.triggers?.[0]?.type ?? null;
}
