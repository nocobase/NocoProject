import { useTranslation } from '@nocobase/i18n/client';
import { BotIcon } from 'lucide-react';
import type { ReactElement } from 'react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { isRuntimeOnline } from '@/pages/np/constants';
import type { AgentListItem, ExecutorRef } from '@/pages/np/types';

export interface NpExecutorSelectProps {
  readonly id?: string;
  readonly value: ExecutorRef;
  readonly agents: readonly AgentListItem[];
  /** Label for a person currently set as executor, which the Phase 0 picker cannot choose but must display. */
  readonly userExecutorName?: string | null;
  readonly onChange: (executor: ExecutorRef) => void;
  readonly disabled?: boolean;
  readonly className?: string;
  readonly 'aria-label'?: string;
}

function encode(executor: ExecutorRef): string {
  return executor.type === 'none' || !executor.id
    ? 'none'
    : `${executor.type}:${executor.id}`;
}

function decode(value: string): ExecutorRef {
  const separator = value.indexOf(':');
  if (value === 'none' || separator < 0) return { type: 'none', id: null };
  const type = value.slice(0, separator);
  return {
    type: type === 'user' ? 'user' : 'agent',
    id: value.slice(separator + 1),
  };
}

/** Executor picker: nobody, or one of the agents (with its runtime's online state). */
export function NpExecutorSelect({
  id,
  value,
  agents,
  userExecutorName,
  onChange,
  disabled,
  className,
  'aria-label': ariaLabel,
}: NpExecutorSelectProps): ReactElement {
  const { t } = useTranslation();
  const selected = encode(value);
  const items = [
    { value: 'none', label: t('np.executor.none') },
    ...(value.type === 'user' && value.id
      ? [
          {
            value: selected,
            label: userExecutorName ?? t('np.executor.person'),
          },
        ]
      : []),
    ...agents.map((agent) => ({
      value: `agent:${agent.id}`,
      label: agent.name,
    })),
  ];
  // An agent that is no longer listed (archived) still displays by id rather than as an empty trigger.
  if (!items.some((item) => item.value === selected)) {
    items.push({ value: selected, label: value.id ?? selected });
  }

  return (
    <Select
      items={items}
      value={selected}
      disabled={disabled}
      onValueChange={(next) => {
        if (next !== null && next !== selected) onChange(decode(next));
      }}
    >
      <SelectTrigger
        id={id}
        aria-label={ariaLabel}
        className={cn('w-full', className)}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => {
          const agent = item.value.startsWith('agent:')
            ? agents.find((candidate) => `agent:${candidate.id}` === item.value)
            : undefined;
          return (
            <SelectItem key={item.value} value={item.value}>
              {agent ? (
                <span className='flex min-w-0 items-center gap-2'>
                  <BotIcon
                    className='size-3.5 text-muted-foreground'
                    aria-hidden='true'
                  />
                  <span className='truncate'>{item.label}</span>
                  <span className='text-xs text-muted-foreground'>
                    {isRuntimeOnline(agent)
                      ? t('np.common.online')
                      : t('np.common.offline')}
                  </span>
                </span>
              ) : (
                item.label
              )}
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
