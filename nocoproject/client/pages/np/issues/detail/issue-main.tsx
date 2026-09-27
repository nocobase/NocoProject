import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useQuery } from '@tanstack/react-query';
import { CornerLeftUpIcon } from 'lucide-react';
import { type ReactElement, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';

import { Breadcrumbs } from '@/components/breadcrumbs';
import { NpStatusBadge } from '@/components/np-badges';
import type { NpRichTextHandle } from '@/components/np-rich-text-editor';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';

import { fetchMembers } from '../../api-collab.js';
import { npKeys } from '../../constants.js';
import type {
  AgentListItem,
  IssueComment,
  IssueDetail,
  Me,
} from '../../types.js';
import { ActivityTimeline } from './activity-timeline.js';
import { ApprovalsCard } from './approvals-card.js';
import { CommentComposer } from './comment-composer.js';
import { DependenciesSection } from './dependencies-section.js';
import { IssueDescription, IssueTitle } from './issue-content.js';
import { ProposalsCard } from './proposals-card.js';
import { PullRequestsSection } from './pull-requests-section.js';
import { SubtasksSection } from './subtasks-section.js';
import { buildTimeline, mergeActivities } from './timeline.js';
import { useOlderActivities } from './use-older-activities.js';

/**
 * The main column: parent link, heading, description, pending approvals, executor proposals, then pull requests,
 * sub-issues and dependencies as cards, the activity timeline (older activities on demand, virtualized when long,
 * iteration 3 §D / §H 8) and the comment composer pinned under it (⌘Enter sends).
 */
export function IssueMain({
  detail,
  agents,
  me,
}: {
  readonly detail: IssueDetail;
  readonly agents: readonly AgentListItem[];
  readonly me?: Me;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const { issue } = detail;
  const editorRef = useRef<NpRichTextHandle>(null);
  const [replyTo, setReplyTo] = useState<IssueComment | null>(null);
  const members = useQuery({
    queryKey: npKeys.members,
    queryFn: () => fetchMembers(api),
  });

  const names = useMemo(
    () => new Map(agents.map((agent) => [agent.id, agent.name])),
    [agents],
  );
  const agentName = (agentId: string | null | undefined): string | null =>
    agentId ? (names.get(agentId) ?? null) : null;
  const userName = (userId: string): string =>
    members.data?.find((member) => member.userId === userId)?.name ??
    (userId === me?.userId ? me.name : userId);

  const older = useOlderActivities(issue.id, detail.activitiesNextCursor);
  const timeline = useMemo(
    () =>
      buildTimeline({
        ...detail,
        activities: mergeActivities(older.activities, detail.activities),
      }),
    [detail, older.activities],
  );
  const replyToName = replyTo
    ? (replyTo.authorName ??
      (replyTo.authorType === 'agent' ? agentName(replyTo.authorId) : null))
    : null;

  return (
    <>
      <div className='min-h-0 flex-1 overflow-y-auto'>
        <div className='w-full space-y-6 p-6 md:p-8'>
          <div className='space-y-3'>
            <Breadcrumbs />
            {detail.parent ? (
              <Link
                to={`../${encodeURIComponent(detail.parent.id)}`}
                relative='path'
                className='inline-flex max-w-full items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground'
              >
                <CornerLeftUpIcon
                  className='size-3.5 shrink-0'
                  aria-hidden='true'
                />
                <span className='shrink-0'>{t('np.issue.parent')}</span>
                <span className='shrink-0 font-mono'>
                  {detail.parent.identifier}
                </span>
                <span className='truncate'>{detail.parent.title}</span>
              </Link>
            ) : null}
            <div className='flex items-center gap-2 text-sm text-muted-foreground'>
              <span className='font-mono text-xs'>{issue.identifier}</span>
              <NpStatusBadge
                statusKey={issue.statusKey}
                catalog={detail.statusCatalog}
              />
            </div>
            <IssueTitle issue={issue} />
          </div>
          <IssueDescription issue={issue} agents={agents} />
          <ApprovalsCard
            issueId={issue.id}
            approvals={detail.approvals}
            catalog={detail.statusCatalog}
            meUserId={me?.userId}
          />
          <ProposalsCard
            issueId={issue.id}
            proposals={detail.proposals}
            agents={agents}
          />
          <Card>
            <CardContent>
              <PullRequestsSection
                issueId={issue.id}
                pullRequests={detail.pullRequests}
              />
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <SubtasksSection
                issueId={issue.id}
                subtasks={detail.subtasks}
                catalog={detail.statusCatalog}
              />
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <DependenciesSection detail={detail} />
            </CardContent>
          </Card>
          <section className='space-y-4' aria-labelledby='np-activity-heading'>
            <div className='flex items-center justify-between gap-2'>
              <h2
                id='np-activity-heading'
                className='font-heading text-base font-semibold'
              >
                {t('np.activity.title')}
              </h2>
              {older.hasMore ? (
                <Button
                  variant='ghost'
                  size='sm'
                  disabled={older.loading}
                  onClick={older.loadMore}
                >
                  {older.loading ? <Spinner data-icon='inline-start' /> : null}
                  {t('np.activity.loadOlder')}
                </Button>
              ) : null}
            </div>
            <ActivityTimeline
              entries={timeline}
              statusCatalog={detail.statusCatalog}
              issueId={issue.id}
              meUserId={me?.userId}
              agentName={agentName}
              userName={userName}
              replyingToId={replyTo?.id ?? null}
              onReply={(comment) => {
                setReplyTo(comment);
                editorRef.current?.focus();
              }}
            />
          </section>
        </div>
      </div>
      <div className='sticky bottom-0 border-t bg-background'>
        <div className='w-full px-6 py-3 md:px-8'>
          <CommentComposer
            issueId={issue.id}
            executor={{ type: issue.executorType, id: issue.executorId }}
            agents={agents}
            agentName={agentName}
            replyTo={replyTo}
            replyToName={replyToName}
            onCancelReply={() => setReplyTo(null)}
            editorRef={editorRef}
          />
        </div>
      </div>
    </>
  );
}
