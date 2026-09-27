import { ApiClientError, useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useQueryClient } from '@tanstack/react-query';
import { BotIcon, SendIcon, XIcon, ZapIcon } from 'lucide-react';
import { type ReactElement, type RefObject, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';

import { createComment } from '../../api.js';
import { npKeys } from '../../constants.js';
import type { AgentListItem, ExecutorRef, IssueComment } from '../../types.js';
import { computeTriggerPreview } from '../trigger-preview.js';
import { MentionTextarea } from './mention-textarea.js';

export interface CommentComposerProps {
  readonly issueId: string;
  readonly executor: ExecutorRef;
  readonly agents: readonly AgentListItem[];
  readonly agentName: (agentId: string | null | undefined) => string | null;
  readonly replyTo: IssueComment | null;
  readonly replyToName: string | null;
  readonly onCancelReply: () => void;
  readonly textareaRef: RefObject<HTMLTextAreaElement | null>;
}

/**
 * The comment box under the activity. A reply posts with `parentId` set to the comment being answered. The line under
 * the box previews which agents the comment will trigger, from the same rules the server applies (protocol §2).
 */
export function CommentComposer({
  issueId,
  executor,
  agents,
  agentName,
  replyTo,
  replyToName,
  onCancelReply,
  textareaRef,
}: CommentComposerProps): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [content, setContent] = useState('');
  const [pending, setPending] = useState(false);

  const preview = computeTriggerPreview({ content, replyTo, executor });
  const names = preview.agentIds
    .map((id) => agentName(id) ?? t('np.common.unknownAgent'))
    .join(t('np.comment.nameSeparator'));

  async function submit(): Promise<void> {
    const text = content.trim();
    if (!text || pending) return;
    setPending(true);
    try {
      await createComment(api, issueId, {
        content: text,
        parentId: replyTo?.id,
      });
      setContent('');
      onCancelReply();
      void queryClient.invalidateQueries({ queryKey: npKeys.issue(issueId) });
      void queryClient.invalidateQueries({ queryKey: npKeys.issues });
    } catch (error: unknown) {
      toast.add({
        type: 'error',
        priority: 'high',
        title:
          error instanceof ApiClientError && error.status === 403
            ? t('np.common.forbidden')
            : t('np.comment.failed'),
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className='space-y-2'>
      {replyTo ? (
        <div className='flex items-center gap-2 text-xs text-muted-foreground'>
          <span className='truncate'>
            {t('np.comment.replyingTo', {
              name: replyToName ?? t('np.common.unknown'),
            })}
          </span>
          <Button
            variant='ghost'
            size='icon-xs'
            aria-label={t('np.comment.cancelReply')}
            onClick={onCancelReply}
          >
            <XIcon />
          </Button>
        </div>
      ) : null}
      <MentionTextarea
        value={content}
        onChange={setContent}
        agents={agents}
        textareaRef={textareaRef}
        onSubmit={() => void submit()}
        disabled={pending}
        placeholder={t('np.comment.placeholder')}
        aria-label={t('np.comment.label')}
      />
      <div className='flex flex-wrap items-center gap-2'>
        <p
          className='flex min-w-0 flex-1 items-center gap-1.5 text-xs text-muted-foreground'
          aria-live='polite'
          data-testid='np-trigger-preview'
        >
          {preview.agentIds.length > 0 ? (
            <ZapIcon className='size-3.5 shrink-0' aria-hidden='true' />
          ) : (
            <BotIcon className='size-3.5 shrink-0' aria-hidden='true' />
          )}
          <span className='truncate'>
            {t(`np.comment.preview.${preview.reason}`, { names })}
          </span>
        </p>
        <Button
          size='sm'
          disabled={pending || content.trim() === ''}
          onClick={() => void submit()}
        >
          {pending ? (
            <Spinner data-icon='inline-start' />
          ) : (
            <SendIcon data-icon='inline-start' />
          )}
          {replyTo ? t('np.comment.sendReply') : t('np.comment.send')}
        </Button>
      </div>
    </div>
  );
}
