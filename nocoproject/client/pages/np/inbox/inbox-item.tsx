import { useTranslation } from '@nocobase/i18n/client';
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  BotIcon,
  MailIcon,
  MailOpenIcon,
  MoreHorizontalIcon,
  UserIcon,
} from 'lucide-react';
import type { ReactElement } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

import type { InboxAction } from '../api-inbox.js';
import { statusLabelKey } from '../constants.js';
import { failureReasonKey, useNpFormatters } from '../format.js';
import type { InboxItem } from '../types.js';
import { inboxActionsFor, isSettled } from './inbox-model.js';
import { inboxBodyText } from './inbox-text.js';

const ACTION_ICON = {
  read: MailOpenIcon,
  unread: MailIcon,
  archive: ArchiveIcon,
  unarchive: ArchiveRestoreIcon,
} as const;

/**
 * One inbox card. Opening it goes to the issue (and marks it read); the menu button and a right-click offer the same
 * read / unread and archive / unarchive toggles (§J 3). Unread cards carry a dot and bold title; the dot has a text
 * alternative so the state is not carried by weight alone.
 */
export function InboxItemCard({
  item,
  busy,
  onOpen,
  onAction,
}: {
  readonly item: InboxItem;
  readonly busy: boolean;
  readonly onOpen: (item: InboxItem) => void;
  readonly onAction: (item: InboxItem, action: InboxAction) => void;
}): ReactElement {
  const { t } = useTranslation();
  const format = useNpFormatters();
  const unread = item.readAt === null;
  const actions = inboxActionsFor(item);
  const ActorIcon = item.actorType === 'agent' ? BotIcon : UserIcon;
  const label = (action: InboxAction): string =>
    t(`np.inbox.actions.${action}`);
  // The sentence from `type + payload` in the viewer's language; the server's English `body` when it cannot be built.
  const localized = inboxBodyText(
    item,
    (key) => t(statusLabelKey(key), { defaultValue: key }),
    (reason) => t(failureReasonKey(reason), { defaultValue: reason }),
  );
  const body = localized ? t(localized.key, localized.values) : item.body;

  return (
    <ContextMenu>
      <ContextMenuTrigger
        className={cn(
          'group flex items-start gap-3 rounded-lg border bg-card p-3 text-card-foreground transition-colors hover:bg-muted/50',
          isSettled(item) && 'opacity-60',
        )}
      >
        <span
          className='flex h-5 w-2 shrink-0 items-center'
          aria-hidden={!unread}
        >
          {unread ? (
            <span className='size-2 rounded-full bg-primary'>
              <span className='sr-only'>{t('np.inbox.unread')}</span>
            </span>
          ) : null}
        </span>
        <button
          type='button'
          className='min-w-0 flex-1 space-y-1 text-left focus-visible:outline-none'
          onClick={() => onOpen(item)}
        >
          <span className='flex flex-wrap items-center gap-2 text-xs text-muted-foreground'>
            <Badge variant={item.kind === 'decision' ? 'secondary' : 'outline'}>
              {t(`np.inbox.types.${item.type}`, { defaultValue: item.type })}
            </Badge>
            {item.issueIdentifier ? (
              <span className='font-mono'>{item.issueIdentifier}</span>
            ) : null}
            {item.count > 1 ? (
              <span className='tabular-nums'>
                {t('np.inbox.count', { count: item.count })}
              </span>
            ) : null}
            {isSettled(item) ? <span>{t('np.inbox.resolved')}</span> : null}
          </span>
          <span
            className={cn(
              'block truncate text-sm group-focus-within:underline',
              unread ? 'font-semibold' : 'font-medium',
            )}
          >
            {item.title}
          </span>
          {body ? (
            <span className='line-clamp-2 block text-sm text-muted-foreground wrap-anywhere'>
              {body}
            </span>
          ) : null}
          <span className='flex items-center gap-1.5 text-xs text-muted-foreground'>
            {item.actorName ? (
              <>
                <ActorIcon className='size-3.5' aria-hidden='true' />
                <span>{item.actorName}</span>
                <span aria-hidden='true'>·</span>
              </>
            ) : null}
            <time
              dateTime={item.updatedAt}
              title={format.dateTime(item.updatedAt)}
            >
              {format.relative(item.updatedAt)}
            </time>
          </span>
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant='ghost'
                size='icon-sm'
                disabled={busy}
                aria-label={t('np.inbox.actionsFor', { title: item.title })}
              />
            }
          >
            <MoreHorizontalIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end'>
            <DropdownMenuGroup>
              {actions.map((action) => {
                const Icon = ACTION_ICON[action];
                return (
                  <DropdownMenuItem
                    key={action}
                    onClick={() => onAction(item, action)}
                  >
                    <Icon />
                    {label(action)}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuGroup>
          {actions.map((action) => {
            const Icon = ACTION_ICON[action];
            return (
              <ContextMenuItem
                key={action}
                disabled={busy}
                onClick={() => onAction(item, action)}
              >
                <Icon />
                {label(action)}
              </ContextMenuItem>
            );
          })}
        </ContextMenuGroup>
      </ContextMenuContent>
    </ContextMenu>
  );
}
