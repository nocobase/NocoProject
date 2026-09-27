import { useTranslation } from '@nocobase/i18n/client';
import type { ReactElement, ReactNode } from 'react';

import { NpExecutor, NpStatusBadge } from '@/components/np-badges';
import { NpExecutorSelect } from '@/components/np-executor-select';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Spinner } from '@/components/ui/spinner';

import { ISSUE_PRIORITIES, statusLabelKey } from '../../constants.js';
import { useNpFormatters } from '../../format.js';
import type {
  AgentListItem,
  IssueDetail,
  IssuePriority,
  Me,
} from '../../types.js';
import { ExecutionLog } from './execution-log.js';
import { useIssueUpdate } from './use-issue-update.js';

function PropertyRow({
  label,
  htmlFor,
  children,
}: {
  readonly label: ReactNode;
  readonly htmlFor?: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <div className='grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-3 text-sm'>
      {htmlFor ? (
        <label htmlFor={htmlFor} className='text-muted-foreground'>
          {label}
        </label>
      ) : (
        <span className='text-muted-foreground'>{label}</span>
      )}
      <div className='min-w-0'>{children}</div>
    </div>
  );
}

/** The right-hand panel: editable properties, timestamps and the execution log. */
export function PropertiesPanel({
  detail,
  agents,
  me,
}: {
  readonly detail: IssueDetail;
  readonly agents: readonly AgentListItem[];
  readonly me: Me | undefined;
}): ReactElement {
  const { t } = useTranslation();
  const format = useNpFormatters();
  const { issue, statusCatalog } = detail;
  const update = useIssueUpdate(issue);

  const statusItems = statusCatalog.map((entry) => ({
    value: entry.key,
    label: t(statusLabelKey(entry.key), { defaultValue: entry.key }),
  }));
  const priorityItems = ISSUE_PRIORITIES.map((value) => ({
    value,
    label: t(`np.priority.${value}`),
  }));

  return (
    <div className='space-y-6 p-4 md:p-6'>
      <section className='space-y-3' aria-labelledby='np-properties-heading'>
        <h2
          id='np-properties-heading'
          className='flex items-center gap-2 text-sm font-semibold'
        >
          {t('np.properties.title')}
          {update.isPending ? (
            <Spinner
              className='size-3.5 text-muted-foreground'
              aria-label={t('np.common.saving')}
            />
          ) : null}
        </h2>
        <PropertyRow label={t('np.properties.status')} htmlFor='np-prop-status'>
          <Select
            items={statusItems}
            value={issue.statusKey}
            disabled={update.isPending}
            onValueChange={(value) => {
              if (value && value !== issue.statusKey) {
                update.mutate({ statusKey: value });
              }
            }}
          >
            <SelectTrigger id='np-prop-status' size='sm' className='w-full'>
              <SelectValue>
                {() => (
                  <NpStatusBadge
                    statusKey={issue.statusKey}
                    catalog={statusCatalog}
                  />
                )}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {statusItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </PropertyRow>
        <PropertyRow
          label={t('np.properties.priority')}
          htmlFor='np-prop-priority'
        >
          <Select
            items={priorityItems}
            value={issue.priority}
            disabled={update.isPending}
            onValueChange={(value: IssuePriority | null) => {
              if (value && value !== issue.priority) {
                update.mutate({ priority: value });
              }
            }}
          >
            <SelectTrigger id='np-prop-priority' size='sm' className='w-full'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {priorityItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </PropertyRow>
        <PropertyRow label={t('np.properties.owner')}>
          <div className='flex min-w-0 items-center gap-2'>
            <span className='truncate'>
              {issue.ownerName ?? (
                <span className='text-muted-foreground'>—</span>
              )}
            </span>
            {me && issue.ownerUserId === me.userId ? (
              <span className='text-xs text-muted-foreground'>
                {t('np.properties.you')}
              </span>
            ) : null}
            {me && issue.ownerUserId !== me.userId ? (
              <Button
                variant='ghost'
                size='xs'
                disabled={update.isPending}
                onClick={() => update.mutate({ ownerUserId: me.userId })}
              >
                {t('np.properties.assignToMe')}
              </Button>
            ) : null}
          </div>
        </PropertyRow>
        <PropertyRow
          label={t('np.properties.executor')}
          htmlFor='np-prop-executor'
        >
          <NpExecutorSelect
            id='np-prop-executor'
            className='h-7'
            value={{ type: issue.executorType, id: issue.executorId }}
            agents={agents}
            userExecutorName={
              issue.executorType === 'user' ? issue.executorName : null
            }
            disabled={update.isPending}
            onChange={(executor) => update.mutate({ executor })}
          />
        </PropertyRow>
        {issue.executorType === 'agent' && (issue.activeRunCount ?? 0) > 0 ? (
          <PropertyRow label=''>
            <NpExecutor
              type='agent'
              name={issue.executorName}
              activeRunCount={issue.activeRunCount}
            />
          </PropertyRow>
        ) : null}
      </section>

      <Separator />

      <section className='space-y-3' aria-labelledby='np-details-heading'>
        <h2 id='np-details-heading' className='text-sm font-semibold'>
          {t('np.properties.details')}
        </h2>
        <PropertyRow label={t('np.properties.created')}>
          <span title={format.dateTime(issue.createdAt)}>
            {format.dateTime(issue.createdAt)}
          </span>
        </PropertyRow>
        <PropertyRow label={t('np.properties.updated')}>
          <span title={format.dateTime(issue.updatedAt)}>
            {format.relative(issue.updatedAt)}
          </span>
        </PropertyRow>
      </section>

      <Separator />

      <ExecutionLog runs={detail.runs} agents={agents} issueId={issue.id} />
    </div>
  );
}
