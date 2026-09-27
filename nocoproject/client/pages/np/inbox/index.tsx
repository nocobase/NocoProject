import { ApiClientError, useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { AlertCircleIcon, CheckCheckIcon, InboxIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import { useNavigate, useSearchParams } from 'react-router';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toast';

import {
  type InboxAction,
  applyInboxAction,
  fetchInbox,
  fetchInboxUnread,
  markAllInboxRead,
} from '../api-inbox.js';
import { npKeys } from '../constants.js';
import type { InboxItem, InboxTopicPayload } from '../types.js';
import { useRealtimeTopic } from '../use-realtime.js';
import { InboxItemCard } from './inbox-item.js';
import {
  INBOX_TABS,
  applyInboxActionLocally,
  inboxUnread,
  readInboxTab,
} from './inbox-model.js';

type InboxPage = Awaited<ReturnType<typeof fetchInbox>>;

/**
 * Route `/inbox` (§J 3): what needs the viewer's decision (review requests, blocked agents, executor proposals) and
 * notifications, each tab with its unread count. The tab and "show archived" live in the query string. Opening a card
 * marks it read and goes to its issue. The `np:inbox` user topic invalidates everything here.
 */
export default function InboxPage(): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const tab = readInboxTab(params.get('tab'));
  const archived = params.get('archived') === '1';

  const listKey = npKeys.inboxList(tab, archived);
  const list = useQuery({
    queryKey: listKey,
    queryFn: ({ signal }) => fetchInbox(api, { kind: tab, archived }, signal),
    placeholderData: keepPreviousData,
  });
  const counter = useQuery({
    queryKey: npKeys.inboxUnread,
    queryFn: ({ signal }) => fetchInboxUnread(api, signal),
  });
  const unread = inboxUnread(counter.data, list.data?.unread);

  useRealtimeTopic<InboxTopicPayload>('np:inbox', () => {
    void queryClient.invalidateQueries({ queryKey: npKeys.inbox });
  });

  const act = useMutation({
    mutationFn: ({ item, action }: { item: InboxItem; action: InboxAction }) =>
      applyInboxAction(api, item.id, action),
    onMutate: ({ item, action }) => {
      const now = new Date().toISOString();
      queryClient.setQueryData<InboxPage>(listKey, (current) =>
        current
          ? {
              ...current,
              items: current.items.map((entry) =>
                entry.id === item.id
                  ? applyInboxActionLocally(entry, action, now)
                  : entry,
              ),
            }
          : current,
      );
    },
    onSuccess: (_, { action }) => {
      if (action === 'archive' || action === 'unarchive') {
        toast.add({
          type: 'success',
          title:
            action === 'archive'
              ? t('np.inbox.archived')
              : t('np.inbox.unarchived'),
        });
      }
    },
    onError: () =>
      toast.add({
        type: 'error',
        priority: 'high',
        title: t('np.common.requestFailed'),
      }),
    onSettled: () =>
      void queryClient.invalidateQueries({ queryKey: npKeys.inbox }),
  });

  const readAll = useMutation({
    mutationFn: () => markAllInboxRead(api, tab),
    onSuccess: () =>
      toast.add({ type: 'success', title: t('np.inbox.allRead') }),
    onError: () =>
      toast.add({
        type: 'error',
        priority: 'high',
        title: t('np.common.requestFailed'),
      }),
    onSettled: () =>
      void queryClient.invalidateQueries({ queryKey: npKeys.inbox }),
  });

  function setParam(name: string, value: string | null): void {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    setParams(next, { replace: true });
  }

  function open(item: InboxItem): void {
    if (!item.readAt) act.mutate({ item, action: 'read' });
    if (item.issueId) {
      void navigate(`/issues/${encodeURIComponent(item.issueId)}`);
    }
  }

  const items = list.data?.items;
  let content: ReactElement;
  if (list.isError && !list.isFetching) {
    const forbidden =
      list.error instanceof ApiClientError && list.error.status === 403;
    content = (
      <Alert variant='destructive'>
        <AlertCircleIcon />
        <AlertTitle>{t('np.inbox.loadFailed')}</AlertTitle>
        <AlertDescription>
          {forbidden ? t('np.common.forbidden') : t('np.common.requestFailed')}
        </AlertDescription>
        {forbidden ? null : (
          <AlertAction>
            <Button
              variant='outline'
              size='sm'
              onClick={() => void list.refetch()}
            >
              {t('status.retry')}
            </Button>
          </AlertAction>
        )}
      </Alert>
    );
  } else if (!items) {
    content = (
      <div role='status' aria-label={t('status.loading')} className='space-y-2'>
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className='h-20 w-full rounded-lg' />
        ))}
      </div>
    );
  } else if (items.length === 0) {
    content = (
      <Empty className='border'>
        <EmptyHeader>
          <EmptyMedia variant='icon'>
            <InboxIcon />
          </EmptyMedia>
          <EmptyTitle>
            {archived
              ? t('np.inbox.emptyArchived')
              : t(`np.inbox.empty.${tab}`)}
          </EmptyTitle>
          <EmptyDescription>{t('np.inbox.emptyDescription')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  } else {
    content = (
      <ul className='space-y-2' aria-label={t(`np.inbox.tabs.${tab}`)}>
        {items.map((item) => (
          <li key={item.id}>
            <InboxItemCard
              item={item}
              busy={act.isPending}
              onOpen={open}
              onAction={(target, action) =>
                act.mutate({ item: target, action })
              }
            />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title={t('np.inbox.title')}
        description={t('np.inbox.description')}
        actions={
          <Button
            variant='outline'
            disabled={readAll.isPending || unread[tab] === 0}
            onClick={() => readAll.mutate()}
          >
            {readAll.isPending ? (
              <Spinner data-icon='inline-start' />
            ) : (
              <CheckCheckIcon data-icon='inline-start' />
            )}
            {t('np.inbox.readAll')}
          </Button>
        }
      />
      <div className='space-y-4'>
        <div className='flex flex-wrap items-center justify-between gap-3'>
          <Tabs
            value={tab}
            onValueChange={(value) =>
              setParam('tab', value === 'info' ? 'info' : null)
            }
          >
            <TabsList variant='line'>
              {INBOX_TABS.map((kind) => (
                <TabsTrigger key={kind} value={kind}>
                  {t(`np.inbox.tabs.${kind}`)}
                  {unread[kind] > 0 ? (
                    <Badge
                      variant={kind === 'decision' ? 'default' : 'secondary'}
                      className='tabular-nums'
                      aria-label={t('np.inbox.unreadCount', {
                        count: unread[kind],
                      })}
                    >
                      {unread[kind]}
                    </Badge>
                  ) : null}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <div className='flex items-center gap-2'>
            {list.isFetching && items ? (
              <Spinner
                className='size-4 text-muted-foreground'
                aria-label={t('status.loading')}
              />
            ) : null}
            <Switch
              id='np-inbox-archived'
              checked={archived}
              onCheckedChange={(checked) =>
                setParam('archived', checked ? '1' : null)
              }
            />
            <Label htmlFor='np-inbox-archived'>
              {t('np.inbox.showArchived')}
            </Label>
          </div>
        </div>
        {content}
      </div>
    </PageContainer>
  );
}
