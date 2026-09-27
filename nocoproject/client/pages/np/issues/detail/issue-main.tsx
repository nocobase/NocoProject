import { useTranslation } from '@nocobase/i18n/client';
import { type ReactElement, useMemo, useRef, useState } from 'react';

import { Breadcrumbs } from '@/components/breadcrumbs';
import { NpStatusBadge } from '@/components/np-badges';
import { Separator } from '@/components/ui/separator';

import type { AgentListItem, IssueComment, IssueDetail } from '../../types.js';
import { ActivityTimeline } from './activity-timeline.js';
import { CommentComposer } from './comment-composer.js';
import { IssueDescription, IssueTitle } from './issue-content.js';
import { buildTimeline } from './timeline.js';

/** The main column: heading, description, the activity timeline and the comment composer pinned under it. */
export function IssueMain({
  detail,
  agents,
}: {
  readonly detail: IssueDetail;
  readonly agents: readonly AgentListItem[];
}): ReactElement {
  const { t } = useTranslation();
  const { issue } = detail;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [replyTo, setReplyTo] = useState<IssueComment | null>(null);

  const names = useMemo(
    () => new Map(agents.map((agent) => [agent.id, agent.name])),
    [agents],
  );
  const agentName = (agentId: string | null | undefined): string | null =>
    agentId ? (names.get(agentId) ?? null) : null;

  const timeline = useMemo(() => buildTimeline(detail), [detail]);
  const replyToName = replyTo
    ? (replyTo.authorName ??
      (replyTo.authorType === 'agent' ? agentName(replyTo.authorId) : null))
    : null;

  return (
    <>
      <div className='min-h-0 flex-1 overflow-y-auto'>
        <div className='mx-auto w-full max-w-3xl space-y-6 p-6 md:p-8'>
          <div className='space-y-3'>
            <Breadcrumbs />
            <div className='flex items-center gap-2 text-sm text-muted-foreground'>
              <span className='font-mono'>{issue.identifier}</span>
              <NpStatusBadge
                statusKey={issue.statusKey}
                catalog={detail.statusCatalog}
              />
            </div>
            <IssueTitle issue={issue} />
          </div>
          <IssueDescription issue={issue} />
          <Separator />
          <section className='space-y-4' aria-labelledby='np-activity-heading'>
            <h2
              id='np-activity-heading'
              className='font-heading text-base font-semibold'
            >
              {t('np.activity.title')}
            </h2>
            <ActivityTimeline
              entries={timeline}
              statusCatalog={detail.statusCatalog}
              agentName={agentName}
              replyingToId={replyTo?.id ?? null}
              onReply={(comment) => {
                setReplyTo(comment);
                textareaRef.current?.focus();
              }}
            />
          </section>
        </div>
      </div>
      <div className='sticky bottom-0 border-t bg-background'>
        <div className='mx-auto w-full max-w-3xl px-6 py-3 md:px-8'>
          <CommentComposer
            issueId={issue.id}
            executor={{ type: issue.executorType, id: issue.executorId }}
            agents={agents}
            agentName={agentName}
            replyTo={replyTo}
            replyToName={replyToName}
            onCancelReply={() => setReplyTo(null)}
            textareaRef={textareaRef}
          />
        </div>
      </div>
    </>
  );
}
