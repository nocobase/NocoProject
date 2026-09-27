import { useTranslation } from '@nocobase/i18n/client';
import { BotIcon, UserIcon } from 'lucide-react';
import type { ReactElement } from 'react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  CATEGORY_BADGE,
  RUN_BADGE,
  statusCategory,
  statusLabelKey,
} from '@/pages/np/constants';
import type {
  ExecutorType,
  IssuePriority,
  RunStatus,
  StatusCatalogEntry,
} from '@/pages/np/types';

/** An issue status as a Badge whose variant follows the status category. */
export function NpStatusBadge({
  statusKey,
  catalog,
  className,
}: {
  readonly statusKey: string;
  readonly catalog?: readonly StatusCatalogEntry[];
  readonly className?: string;
}): ReactElement {
  const { t } = useTranslation();
  const category = statusCategory(statusKey, catalog);
  return (
    <Badge
      variant={CATEGORY_BADGE[category]}
      className={cn(
        category === 'closed' && 'text-muted-foreground line-through',
        className,
      )}
    >
      {t(statusLabelKey(statusKey), { defaultValue: statusKey })}
    </Badge>
  );
}

export function NpRunStatusBadge({
  status,
}: {
  readonly status: RunStatus;
}): ReactElement {
  const { t } = useTranslation();
  const active =
    status === 'running' || status === 'dispatched' || status === 'queued';
  return (
    <Badge variant={RUN_BADGE[status]}>
      {active ? <NpPulse /> : null}
      {t(`np.runStatus.${status}`)}
    </Badge>
  );
}

export function NpPriorityLabel({
  priority,
}: {
  readonly priority: IssuePriority;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        'text-sm',
        priority === 'urgent' && 'font-medium text-destructive',
        priority === 'high' && 'font-medium',
        priority === 'none' && 'text-muted-foreground',
      )}
    >
      {t(`np.priority.${priority}`)}
    </span>
  );
}

/** A small pulsing dot marking work in progress; decorative, the surrounding text carries the meaning. */
export function NpPulse({
  className,
}: {
  readonly className?: string;
}): ReactElement {
  return (
    <span
      className={cn('relative flex size-2 shrink-0', className)}
      aria-hidden='true'
    >
      <span className='absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-60' />
      <span className='relative inline-flex size-2 rounded-full bg-primary' />
    </span>
  );
}

/** Online/offline with a dot and a word, so the state is not carried by color alone. */
export function NpOnlineState({
  online,
}: {
  readonly online: boolean;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <span className='inline-flex items-center gap-1.5 text-sm'>
      <span
        aria-hidden='true'
        className={cn(
          'size-2 shrink-0 rounded-full',
          online ? 'bg-primary' : 'bg-muted-foreground/40',
        )}
      />
      <span className={online ? undefined : 'text-muted-foreground'}>
        {online ? t('np.common.online') : t('np.common.offline')}
      </span>
    </span>
  );
}

/**
 * Who executes an issue: a person, an agent (with an "Agent" marker), or nobody. An agent with active runs shows a
 * pulsing "Working" indicator.
 */
export function NpExecutor({
  type,
  name,
  activeRunCount = 0,
}: {
  readonly type: ExecutorType;
  readonly name?: string | null;
  readonly activeRunCount?: number;
}): ReactElement {
  const { t } = useTranslation();
  if (type === 'none' || !name) {
    return (
      <span className='text-sm text-muted-foreground'>
        {type === 'none' ? t('np.executor.none') : '—'}
      </span>
    );
  }
  const Icon = type === 'agent' ? BotIcon : UserIcon;
  return (
    <span className='inline-flex min-w-0 items-center gap-1.5 text-sm'>
      <Icon
        className='size-3.5 shrink-0 text-muted-foreground'
        aria-hidden='true'
      />
      <span className='truncate'>{name}</span>
      {type === 'agent' ? (
        <Badge variant='outline'>{t('np.executor.agentMarker')}</Badge>
      ) : null}
      {type === 'agent' && activeRunCount > 0 ? (
        <span className='inline-flex items-center gap-1 text-xs text-primary'>
          <NpPulse />
          {t('np.executor.working')}
        </span>
      ) : null}
    </span>
  );
}
