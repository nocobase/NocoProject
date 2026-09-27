import type { InboxAction } from '../api-inbox.js';
import type { InboxItem, InboxKind, InboxUnread } from '../types.js';

export const INBOX_TABS: readonly InboxKind[] = ['decision', 'info'];

export function readInboxTab(value: string | null): InboxKind {
  return value === 'info' ? 'info' : 'decision';
}

/** Unread counts per tab: the dedicated counter when it has loaded, else what the list response carried. */
export function inboxUnread(
  counter: InboxUnread | undefined,
  fromList: InboxUnread | null | undefined,
): InboxUnread {
  return counter ?? fromList ?? { decision: 0, info: 0 };
}

/** The two toggles a card offers: read ↔ unread, archive ↔ unarchive. */
export function inboxActionsFor(item: InboxItem): readonly InboxAction[] {
  return [
    item.readAt ? 'unread' : 'read',
    item.archivedAt ? 'unarchive' : 'archive',
  ];
}

/** The item as it looks right after `action`, for the optimistic list update. */
export function applyInboxActionLocally(
  item: InboxItem,
  action: InboxAction,
  now: string,
): InboxItem {
  switch (action) {
    case 'read':
      return { ...item, readAt: item.readAt ?? now };
    case 'unread':
      return { ...item, readAt: null };
    case 'archive':
      return { ...item, archivedAt: now };
    case 'unarchive':
      return { ...item, archivedAt: null };
  }
}

/** A decision is settled once the server marks it resolved (§E); it stays listed, dimmed, until archived. */
export function isSettled(item: InboxItem): boolean {
  return item.kind === 'decision' && item.resolvedAt !== null;
}

/** The navigation badge: the unread decision count, "99+" above 99 so the badge keeps its size, none at zero. */
export function inboxBadgeText(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  return count > 99 ? '99+' : String(count);
}
