import { useTranslation } from '@nocobase/i18n/client';
import type { ReactElement } from 'react';

import { NpMarkdown } from '@/components/np-markdown';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

import { useNpFormatters } from '../../format.js';
import type { RunEvent } from '../../types.js';

const PREVIEW_LIMIT = 280;

function stringify(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2) ?? '';
  } catch {
    return '';
  }
}

/** Monospace block that shows a one-line preview and expands to the full text. */
function CodeBlock({ text }: { readonly text: string }): ReactElement | null {
  const { t } = useTranslation();
  if (!text) return null;
  const firstLine = text.split('\n', 1)[0] ?? '';
  const long = text.length > PREVIEW_LIMIT || text.includes('\n');
  if (!long) {
    return (
      <pre className='font-mono text-xs whitespace-pre-wrap wrap-anywhere text-muted-foreground'>
        {text}
      </pre>
    );
  }
  return (
    <details className='group'>
      <summary className='cursor-pointer truncate font-mono text-xs text-muted-foreground marker:text-muted-foreground'>
        {firstLine.slice(0, PREVIEW_LIMIT)}
        <span className='ml-2 text-xs group-open:hidden'>
          {t('np.transcript.expand')}
        </span>
      </summary>
      <pre className='mt-1 max-h-96 overflow-auto rounded-md bg-muted p-2 font-mono text-xs whitespace-pre-wrap wrap-anywhere'>
        {text}
      </pre>
    </details>
  );
}

/** One transcript row: a kind label, the content in the form that suits it, then sequence number and time. */
export function TranscriptEvent({
  event,
}: {
  readonly event: RunEvent;
}): ReactElement {
  const { t } = useTranslation();
  const format = useNpFormatters();

  let label: ReactElement;
  let body: ReactElement | null;
  switch (event.type) {
    case 'text':
      label = <Badge>{t('np.transcript.kinds.text')}</Badge>;
      body = <NpMarkdown content={event.content ?? ''} />;
      break;
    case 'thinking':
      label = (
        <Badge variant='outline'>{t('np.transcript.kinds.thinking')}</Badge>
      );
      body = (
        <p className='text-sm whitespace-pre-wrap wrap-anywhere text-muted-foreground italic'>
          {event.content}
        </p>
      );
      break;
    case 'toolUse':
      label = (
        <Badge variant='secondary'>
          {event.tool ?? t('np.transcript.kinds.toolUse')}
        </Badge>
      );
      body = <CodeBlock text={stringify(event.input ?? event.content)} />;
      break;
    case 'toolResult':
      label = (
        <Badge variant='outline'>
          {event.tool ?? t('np.transcript.kinds.toolResult')}
        </Badge>
      );
      body = <CodeBlock text={stringify(event.output ?? event.content)} />;
      break;
    case 'error':
      label = (
        <Badge variant='destructive'>{t('np.transcript.kinds.error')}</Badge>
      );
      body = (
        <p className='text-sm whitespace-pre-wrap wrap-anywhere text-destructive'>
          {event.content ?? event.output}
        </p>
      );
      break;
    default:
      label = <Badge variant='ghost'>{t('np.transcript.kinds.status')}</Badge>;
      body = <p className='text-xs text-muted-foreground'>{event.content}</p>;
  }

  return (
    <li
      className={cn(
        'grid grid-cols-[6.5rem_minmax(0,1fr)_auto] items-start gap-3 border-b px-4 py-2.5 last:border-b-0',
        event.type === 'status' && 'py-1.5',
      )}
    >
      <div className='min-w-0 pt-0.5 [&>*]:max-w-full [&>*]:truncate'>
        {label}
      </div>
      <div className='min-w-0 space-y-1'>
        {body}
        {event.truncated ? (
          <p className='text-xs text-muted-foreground'>
            {t('np.transcript.truncated')}
          </p>
        ) : null}
      </div>
      <div className='flex shrink-0 flex-col items-end text-xs text-muted-foreground tabular-nums'>
        <span>#{event.seq}</span>
        <time dateTime={event.at}>{format.time(event.at)}</time>
      </div>
    </li>
  );
}
