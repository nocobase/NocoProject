import { ApiClientError, useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import {
  type InfiniteData,
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { CheckCheckIcon, InboxIcon } from 'lucide-react';
import { type ReactElement, useState } from 'react';
import { Outlet, useNavigate, useSearchParams } from 'react-router';

import { NpShortcuts } from '@/components/np-shortcuts';
import { NpEmpty, NpListSkeleton, NpLoadError } from '@/components/np-states';
import { NpVirtualList } from '@/components/np-virtual-list';
import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toast';

import {
  type InboxAction,
  type InboxPage,
  applyInboxAction,
  fetchInbox,
  fetchInboxUnread,
  markAllInboxRead,
} from '../api-inbox.js';
import { npKeys } from '../constants.js';
import type { InboxItem, InboxTopicPayload } from '../types.js';
import type { InboxDecisionAction } from '../types-iter3.js';
import { useRealtimeTopic } from '../use-realtime.js';
import { useActionLabel } from './use-action-label.js';
import {
  actionBody,
  apiPath,
  externalUrl,
  inAppPath,
  readInboxActions,
  resolveLocally,
} from './decision-actions.js';
import { InboxItemCard } from './inbox-item.js';
import {
  INBOX_TABS,
  applyInboxActionLocally,
  inboxItemLink,
  inboxUnread,
  readInboxTab,
} from './inbox-model.js';

type InboxPages = InfiniteData<InboxPage, string | null>;

/**
 * Route `/inbox` (§J 3): what needs the viewer's decision and notifications, each tab with its unread count. The tab
 * and "show archived" live in the query string. A decision card acts inline from its `payload.actions` (iteration 3
 * §E): the card resolves at once and the request follows; a failure puts it back with a toast. Approvals waiting for
 * the viewer are decisions like the others (the old `approvals` page redirects here). Opening a card marks it read
 * and goes to its issue or knowledge document. The `np:inbox` user topic invalidates everything here.
 */
export default function InboxPage(): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const actionLabel = useActionLabel();
  const [params, setParams] = useSearchParams();
  const tab = readInboxTab(params.get('tab'));
  const archived = params.get('archived') === '1';
  const [pending, setPending] = useState<{
    readonly itemId: string;
    readonly key: string;
  } | null>(null);

  const listKey = npKeys.inboxList(tab, archived);
  const list = useInfiniteQuery({
    queryKey: listKey,
    queryFn: ({ pageParam, signal }) =>
      fetchInbox(api, { kind: tab, archived }, signal, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last: InboxPage) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
  const counter = useQuery({
    queryKey: npKeys.inboxUnread,
    queryFn: ({ signal }) => fetchInboxUnread(api, signal),
  });
  const unread = inboxUnread(counter.data, list.data?.pages[0]?.unread);

  useRealtimeTopic<InboxTopicPayload>('np:inbox', () => {
    void queryClient.invalidateQueries({ queryKey: npKeys.inbox });
  });

  function patchItem(itemId: string, change: (item: InboxItem) => InboxItem) {
    queryClient.setQueryData<InboxPages>(listKey, (current) =>
      current
        ? {
            ...current,
            pages: current.pages.map((page) => ({
              ...page,
              items: page.items.map((entry) =>
                entry.id === itemId ? change(entry) : entry,
              ),
            })),
          }
        : current,
    );
  }

  const act = useMutation({
    mutationFn: ({ item, action }: { item: InboxItem; action: InboxAction }) =>
      applyInboxAction(api, item.id, action),
    onMutate: ({ item, action }) => {
      const now = new Date().toISOString();
      patchItem(item.id, (entry) =>
        applyInboxActionLocally(entry, action, now),
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

  const decide = useMutation({
    mutationFn: ({
      action,
      comment,
    }: {
      item: InboxItem;
      action: InboxDecisionAction;
      comment: string;
    }) =>
      api.request<unknown, Record<string, unknown>>({
        path: apiPath(action.path ?? ''),
        method: action.method ?? 'POST',
        json: actionBody(action, comment),
      }),
    onMutate: ({ item, action }) => {
      setPending({ itemId: item.id, key: action.key });
      const now = new Date().toISOString();
      patchItem(item.id, (entry) => resolveLocally(entry, now));
    },
    onSuccess: (_, { action, item }) =>
      toast.add({
        type: 'success',
        title: t('np.inboxActions.done', {
          action: actionLabel(action),
          title: item.title,
        }),
      }),
    onError: (error: unknown) =>
      toast.add({
        type: 'error',
        priority: 'high',
        title:
          error instanceof ApiClientError && error.status === 403
            ? t('np.common.forbidden')
            : error instanceof ApiClientError && error.status === 409
              ? t('np.inboxActions.conflict')
              : t('np.common.requestFailed'),
      }),
    onSettled: () => {
      setPending(null);
      void queryClient.invalidateQueries({ queryKey: npKeys.inbox });
      void queryClient.invalidateQueries({ queryKey: npKeys.issues });
      void queryClient.invalidateQueries({ queryKey: ['np', 'issue'] });
      void queryClient.invalidateQueries({ queryKey: npKeys.approvals });
      void queryClient.invalidateQueries({ queryKey: npKeys.knowledge });
    },
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
    const link = inboxItemLink(item);
    if (link) void navigate(link);
  }

  function run(
    item: InboxItem,
    action: InboxDecisionAction,
    comment: string,
  ): void {
    const external = externalUrl(action);
    if (external) {
      window.open(external, '_blank', 'noopener,noreferrer');
      if (!item.readAt) act.mutate({ item, action: 'read' });
      return;
    }
    const page = inAppPath(action);
    if (page) {
      if (!item.readAt) act.mutate({ item, action: 'read' });
      void navigate(page);
      return;
    }
    if (action.opensIssue || !action.path || action.method === 'GET') {
      open(item);
      return;
    }
    decide.mutate({ item, action, comment });
  }

  const items = list.data?.pages.flatMap((page) => page.items);
  let content: ReactElement;
  if (list.isError && !list.isFetching) {
    content = (
      <NpLoadError
        title={t('np.inbox.loadFailed')}
        error={list.error}
        onRetry={() => void list.refetch()}
      />
    );
  } else if (!items) {
    content = <NpListSkeleton rows={4} />;
  } else if (items.length === 0) {
    content = (
      <NpEmpty
        icon={<InboxIcon />}
        title={
          archived ? t('np.inbox.emptyArchived') : t(`np.inbox.empty.${tab}`)
        }
        description={t('np.inbox.emptyDescription')}
      />
    );
  } else {
    content = (
      <div className='space-y-3'>
        <NpVirtualList
          as='ul'
          gapClassName='space-y-2'
          label={t(`np.inbox.tabs.${tab}`)}
          items={items}
          itemKey={(item) => item.id}
          renderItem={(item) => (
            <InboxItemCard
              item={item}
              busy={act.isPending}
              onOpen={open}
              onAction={(target, action) =>
                act.mutate({ item: target, action })
              }
              decision={
                item.kind === 'decision'
                  ? {
                      actions: readInboxActions(item),
                      pendingKey:
                        pending?.itemId === item.id ? pending.key : null,
                      onRun: (action, comment) => run(item, action, comment),
                    }
                  : undefined
              }
            />
          )}
        />
        {list.hasNextPage ? (
          <div className='flex justify-center'>
            <Button
              variant='outline'
              size='sm'
              disabled={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            >
              {list.isFetchingNextPage ? (
                <Spinner data-icon='inline-start' />
              ) : null}
              {t('np.pagination.loadMore')}
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <>
      <PageContainer>
        <PageHeader
          title={t('np.inbox.title')}
          description={t('np.inbox.description')}
          actions={
            <>
              <NpShortcuts showTrigger />
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
            </>
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
      <Outlet />
    </>
  );
}
