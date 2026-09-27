import { useTranslation } from '@nocobase/i18n/client';
import { ExternalLinkIcon, SendIcon } from 'lucide-react';
import { type ReactElement, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';

import type { InboxDecisionAction } from '../types-iter3.js';
import { actionVariant, externalUrl } from './decision-actions.js';
import { useActionLabel } from './use-action-label.js';

/**
 * The buttons of a decision card (§E), acted on without leaving the inbox. An action that `needsComment` opens an
 * inline text field first (⌘Enter sends); `opensIssue` goes to the issue; an external link (`openPr`) opens a new
 * tab. `pendingKey` is the action in flight.
 */
export function DecisionActionsBar({
  actions,
  itemTitle,
  pendingKey,
  disabled,
  onRun,
}: {
  readonly actions: readonly InboxDecisionAction[];
  readonly itemTitle: string;
  readonly pendingKey: string | null;
  readonly disabled: boolean;
  readonly onRun: (action: InboxDecisionAction, comment: string) => void;
}): ReactElement | null {
  const { t } = useTranslation();
  const label = useActionLabel();
  const [commenting, setCommenting] = useState<InboxDecisionAction | null>(
    null,
  );
  const [comment, setComment] = useState('');
  if (actions.length === 0) return null;

  function send(): void {
    if (!commenting || !comment.trim()) return;
    onRun(commenting, comment);
    setCommenting(null);
    setComment('');
  }

  if (commenting) {
    const name = label(commenting);
    return (
      <div className='space-y-2' data-commenting={commenting.key}>
        <Textarea
          value={comment}
          rows={3}
          autoFocus
          placeholder={t('np.inboxActions.commentPlaceholder')}
          aria-label={t('np.inboxActions.commentFor', {
            action: name,
            title: itemTitle,
          })}
          onChange={(event) => setComment(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              send();
            }
            if (event.key === 'Escape') {
              event.stopPropagation();
              setCommenting(null);
              setComment('');
            }
          }}
        />
        <div className='flex flex-wrap items-center justify-end gap-2'>
          <span className='mr-auto text-xs text-muted-foreground'>
            <Kbd>⌘</Kbd> <Kbd>Enter</Kbd>
          </span>
          <Button
            variant='ghost'
            size='sm'
            onClick={() => {
              setCommenting(null);
              setComment('');
            }}
          >
            {t('actions.cancel')}
          </Button>
          <Button
            size='sm'
            variant={actionVariant(commenting.kind)}
            disabled={!comment.trim() || disabled}
            onClick={send}
          >
            <SendIcon data-icon='inline-start' />
            {name}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className='flex flex-wrap gap-2'>
      {actions.map((action) => {
        const external = externalUrl(action);
        const pending = pendingKey === action.key;
        return (
          <Button
            key={action.key}
            size='sm'
            variant={actionVariant(action.kind)}
            disabled={disabled || pendingKey !== null}
            data-action={action.key}
            onClick={() => {
              if (action.needsComment) setCommenting(action);
              else onRun(action, '');
            }}
          >
            {pending ? <Spinner data-icon='inline-start' /> : null}
            {label(action)}
            {external ? <ExternalLinkIcon data-icon='inline-end' /> : null}
          </Button>
        );
      })}
    </div>
  );
}
