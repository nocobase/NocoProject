import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { InboxIcon } from 'lucide-react';
import type { ReactElement } from 'react';

import { cn } from '@/lib/utils';
import { fetchInboxUnread } from '@/pages/np/api-inbox';
import { inboxBadgeText } from '@/pages/np/inbox/inbox-model';
import { npKeys } from '@/pages/np/constants';
import type { InboxTopicPayload } from '@/pages/np/types';
import { useRealtimeTopic } from '@/pages/np/use-realtime';

/**
 * The inbox navigation icon with the number of unread decisions (iteration 1 leftover "导航收件箱未读角标").
 *
 * The navigation contract only takes an icon component, so the badge rides on the icon rather than on a change to
 * the shared navigation tree. It reads `GET /np/inbox/unread-count` and refreshes on the `np:inbox` user topic, the
 * same signal the inbox page listens to; the count shares its query key, so either refresh updates both.
 */
export function NpInboxNavIcon({
  className,
}: {
  readonly className?: string;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const unread = useQuery({
    queryKey: npKeys.inboxUnread,
    queryFn: ({ signal }) => fetchInboxUnread(api, signal),
    retry: false,
    staleTime: 30_000,
  });
  useRealtimeTopic<InboxTopicPayload>('np:inbox', () => {
    void queryClient.invalidateQueries({ queryKey: npKeys.inbox });
  });
  const text = inboxBadgeText(unread.data?.decision ?? 0);

  return (
    <span className='relative inline-flex'>
      <InboxIcon className={className} aria-hidden='true' />
      {text ? (
        <span
          className={cn(
            'absolute -top-1.5 -right-2 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-0.5 text-[0.625rem] leading-none font-semibold text-primary-foreground tabular-nums',
          )}
          data-testid='np-inbox-badge'
        >
          {text}
          <span className='sr-only'>
            {t('np.inbox.unreadDecisions', {
              count: unread.data?.decision ?? 0,
            })}
          </span>
        </span>
      ) : null}
    </span>
  );
}
