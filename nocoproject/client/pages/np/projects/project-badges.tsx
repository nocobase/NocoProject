import { useTranslation } from '@nocobase/i18n/client';
import type { ReactElement } from 'react';

import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';

import type { ProjectStatus } from '../types.js';
import { projectStatusKey } from './progress.js';

export function ProjectStatusBadge({
  status,
}: {
  readonly status: ProjectStatus | undefined;
}): ReactElement {
  const { t } = useTranslation();
  const value = status ?? 'planned';
  return (
    <Badge
      variant={
        value === 'in_progress'
          ? 'secondary'
          : value === 'completed'
            ? 'default'
            : 'outline'
      }
      className={
        value === 'cancelled' ? 'text-muted-foreground line-through' : undefined
      }
    >
      {t(projectStatusKey(value))}
    </Badge>
  );
}

export function ProjectProgressBar({
  done,
  total,
  percent,
  label,
}: {
  readonly done: number;
  readonly total: number;
  readonly percent: number;
  readonly label: string;
}): ReactElement {
  return (
    <div className='flex min-w-32 items-center gap-2'>
      <Progress value={percent} aria-label={label} className='flex-1' />
      <span className='text-xs text-muted-foreground tabular-nums'>
        {done}/{total}
      </span>
    </div>
  );
}
