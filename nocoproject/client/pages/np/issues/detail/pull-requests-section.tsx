import { ApiClientError, useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import {
  CheckCircle2Icon,
  CircleDashedIcon,
  GitBranchIcon,
  GitPullRequestIcon,
  LinkIcon,
  RefreshCwIcon,
  UnlinkIcon,
  XCircleIcon,
} from 'lucide-react';
import { type FormEvent, type ReactElement, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';

import {
  linkPullRequest,
  refreshPullRequest,
  setPullRequestAutoComplete,
  unlinkPullRequest,
} from '../../api-iter2.js';
import type { IssuePullRequestView } from '../../types.js';
import {
  PR_BADGE_VARIANT,
  ciReading,
  looksLikePullRequestUrl,
  mergeableReading,
  prBadgeState,
} from './pr-model.js';
import { useDetailMutation } from './use-detail-mutation.js';

const CI_ICON = {
  success: CheckCircle2Icon,
  failure: XCircleIcon,
  pending: CircleDashedIcon,
  none: CircleDashedIcon,
} as const;

/**
 * Pull requests linked to the issue (iteration 2 §C), above the sub-issues: number and title linking to GitHub, the
 * state, the size, CI and mergeability, author and branch. "Auto-complete" is the per-link opt-out of the merge rule
 * (when every counted PR is merged the issue moves to the configured status). PRs link themselves through the branch
 * name or the identifier in the title; "Link PR by URL" covers the rest.
 */
export function PullRequestsSection({
  issueId,
  pullRequests,
}: {
  readonly issueId: string;
  readonly pullRequests: readonly IssuePullRequestView[];
}): ReactElement {
  const { t } = useTranslation();
  const [linking, setLinking] = useState(false);

  return (
    <section className='space-y-3' aria-labelledby='np-prs-heading'>
      <div className='flex items-center justify-between gap-2'>
        <h2
          id='np-prs-heading'
          className='font-heading text-base font-semibold'
        >
          {t('np.pullRequests.title')}
          {pullRequests.length > 0 ? (
            <span className='ml-2 text-sm font-normal text-muted-foreground tabular-nums'>
              {pullRequests.length}
            </span>
          ) : null}
        </h2>
        <Button variant='outline' size='sm' onClick={() => setLinking(true)}>
          <LinkIcon data-icon='inline-start' />
          {t('np.pullRequests.link')}
        </Button>
      </div>
      {pullRequests.length === 0 ? (
        <p className='text-sm text-muted-foreground'>
          {t('np.pullRequests.empty')}
        </p>
      ) : (
        <ul className='space-y-2'>
          {pullRequests.map((pr) => (
            <PullRequestCard key={pr.id} issueId={issueId} pr={pr} />
          ))}
        </ul>
      )}
      <LinkPullRequestDialog
        issueId={issueId}
        open={linking}
        onClose={() => setLinking(false)}
      />
    </section>
  );
}

export function PullRequestCard({
  issueId,
  pr,
}: {
  readonly issueId: string;
  readonly pr: IssuePullRequestView;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const state = prBadgeState(pr);
  const ci = ciReading(pr.ciState);
  const mergeable = mergeableReading(pr.mergeableState);
  const CiIcon = CI_ICON[ci];
  const linkedType = pr.linkedBy?.type ?? pr.linkedByType;
  const linkedByName =
    pr.linkedBy?.name ??
    pr.linkedByName ??
    (linkedType === 'system' ? t('np.pullRequests.linkedAutomatically') : null);

  const refresh = useDetailMutation(issueId, () =>
    refreshPullRequest(api, issueId, pr.id),
  );
  const unlink = useDetailMutation(
    issueId,
    () => unlinkPullRequest(api, issueId, pr.id),
    { success: t('np.pullRequests.unlinked') },
  );
  const autoComplete = useDetailMutation(issueId, (enabled: boolean) =>
    setPullRequestAutoComplete(api, issueId, pr.id, !enabled),
  );
  const busy = refresh.isPending || unlink.isPending || autoComplete.isPending;

  return (
    <li
      className='space-y-2 rounded-lg border bg-card p-3 text-card-foreground'
      data-testid='np-pr-card'
    >
      <div className='flex flex-wrap items-center gap-2'>
        <GitPullRequestIcon
          className='size-4 shrink-0 text-muted-foreground'
          aria-hidden='true'
        />
        <Badge variant={PR_BADGE_VARIANT[state]}>
          {t(`np.pullRequests.state.${state}`)}
        </Badge>
        <a
          href={pr.url}
          target='_blank'
          rel='noreferrer'
          className='min-w-0 flex-1 truncate text-sm font-medium hover:underline'
        >
          <span className='font-mono text-muted-foreground'>
            {pr.repo}#{pr.number}
          </span>{' '}
          {pr.title}
        </a>
      </div>
      <dl className='flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground'>
        <div className='flex items-center gap-1'>
          <dt className='sr-only'>{t('np.pullRequests.lines')}</dt>
          <dd className='tabular-nums'>
            <span className='text-foreground'>+{pr.additions ?? 0}</span>{' '}
            <span>−{pr.deletions ?? 0}</span>
          </dd>
        </div>
        <div className='flex items-center gap-1'>
          <dt>{t('np.pullRequests.files')}</dt>
          <dd className='tabular-nums'>{pr.changedFiles ?? 0}</dd>
        </div>
        <div className='flex items-center gap-1'>
          <dt>{t('np.pullRequests.ci')}</dt>
          <dd
            className={
              ci === 'failure'
                ? 'flex items-center gap-1 text-destructive'
                : 'flex items-center gap-1'
            }
          >
            <CiIcon className='size-3.5' aria-hidden='true' />
            {t(`np.pullRequests.ciState.${ci}`)}
          </dd>
        </div>
        <div className='flex items-center gap-1'>
          <dt>{t('np.pullRequests.mergeable')}</dt>
          <dd
            className={
              mergeable === 'conflicts' ? 'text-destructive' : undefined
            }
          >
            {t(`np.pullRequests.mergeableState.${mergeable}`)}
          </dd>
        </div>
        {pr.authorLogin ? (
          <div className='flex items-center gap-1'>
            <dt>{t('np.pullRequests.author')}</dt>
            <dd>{pr.authorLogin}</dd>
          </div>
        ) : null}
        {linkedByName ? (
          <div className='flex items-center gap-1'>
            <dt>{t('np.pullRequests.linkedBy')}</dt>
            <dd>{linkedByName}</dd>
          </div>
        ) : null}
        {pr.headRef ? (
          <div className='flex min-w-0 items-center gap-1'>
            <dt className='sr-only'>{t('np.pullRequests.branch')}</dt>
            <GitBranchIcon className='size-3.5 shrink-0' aria-hidden='true' />
            <dd className='truncate font-mono'>
              {pr.headRef}
              {pr.baseRef ? ` → ${pr.baseRef}` : ''}
            </dd>
          </div>
        ) : null}
      </dl>
      <div className='flex flex-wrap items-center gap-2'>
        <label className='flex items-center gap-2 text-xs text-muted-foreground'>
          <Switch
            size='sm'
            checked={!pr.autoCompleteDisabled}
            disabled={busy}
            aria-label={t('np.pullRequests.autoCompleteFor', {
              number: pr.number,
            })}
            onCheckedChange={(checked) => autoComplete.mutate(checked)}
          />
          {t('np.pullRequests.autoComplete')}
        </label>
        <div className='ml-auto flex gap-1'>
          <Button
            variant='ghost'
            size='xs'
            disabled={busy}
            onClick={() => refresh.mutate(undefined)}
          >
            {refresh.isPending ? (
              <Spinner data-icon='inline-start' />
            ) : (
              <RefreshCwIcon data-icon='inline-start' />
            )}
            {t('np.pullRequests.refresh')}
          </Button>
          <Button
            variant='ghost'
            size='xs'
            disabled={busy}
            onClick={() => unlink.mutate(undefined)}
          >
            <UnlinkIcon data-icon='inline-start' />
            {t('np.pullRequests.unlink')}
          </Button>
        </div>
      </div>
    </li>
  );
}

function LinkPullRequestDialog({
  issueId,
  open,
  onClose,
}: {
  readonly issueId: string;
  readonly open: boolean;
  readonly onClose: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string>();
  const link = useDetailMutation(
    issueId,
    (value: string) => linkPullRequest(api, issueId, value),
    {
      success: t('np.pullRequests.linked'),
      errorTitle: (failure: ApiClientError) =>
        failure.code === 'GITHUB_NOT_CONFIGURED'
          ? t('np.pullRequests.notConfigured')
          : failure.code === 'INVALID_PR_URL'
            ? t('np.pullRequests.invalidUrl')
            : null,
    },
  );

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const value = url.trim();
    if (!looksLikePullRequestUrl(value)) {
      setError(t('np.pullRequests.invalidUrl'));
      return;
    }
    setError(undefined);
    link.mutate(value, {
      onSuccess: () => {
        setUrl('');
        onClose();
      },
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !link.isPending) onClose();
      }}
    >
      <DialogContent className='sm:max-w-md'>
        <form onSubmit={submit} noValidate className='space-y-4'>
          <DialogHeader>
            <DialogTitle>{t('np.pullRequests.linkTitle')}</DialogTitle>
            <DialogDescription>
              {t('np.pullRequests.linkDescription')}
            </DialogDescription>
          </DialogHeader>
          <Field data-invalid={error ? true : undefined}>
            <FieldLabel htmlFor='np-pr-url'>
              {t('np.pullRequests.url')}
            </FieldLabel>
            <Input
              id='np-pr-url'
              value={url}
              autoFocus
              placeholder='https://github.com/owner/repo/pull/123'
              aria-invalid={error ? true : undefined}
              onChange={(event) => setUrl(event.target.value)}
            />
            {error ? <FieldError>{error}</FieldError> : null}
          </Field>
          <DialogFooter>
            <Button
              type='button'
              variant='outline'
              disabled={link.isPending}
              onClick={onClose}
            >
              {t('actions.cancel')}
            </Button>
            <Button type='submit' disabled={link.isPending}>
              {link.isPending ? <Spinner data-icon='inline-start' /> : null}
              {t('np.pullRequests.linkSubmit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
