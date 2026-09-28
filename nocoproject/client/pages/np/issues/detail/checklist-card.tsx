import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';

import { Checkbox } from '@/components/ui/checkbox';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { toast } from '@/components/ui/toast';

import { fetchIssueChecklists, setChecklistItem } from '../../api-phase2.js';
import { npKeys } from '../../constants.js';
import type { IssueChecklistItem } from '../../types-phase2.js';

/**
 * The checklist an issue's current status generated (NP-77 stage 1 §6): items to check off before it can leave that
 * status for anywhere but a `closed` category status. Renders nothing while the status has none (docs/design/ui-
 * design.md §8.2, empty sections take no room); past statuses are not shown here, only what the issue is on now.
 */
export function ChecklistCard({
  issueId,
}: {
  readonly issueId: string;
}): ReactElement | null {
  const { t } = useTranslation();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const checklists = useQuery({
    queryKey: npKeys.issueChecklists(issueId),
    queryFn: ({ signal }) => fetchIssueChecklists(api, issueId, signal),
  });
  const current = checklists.data?.find((entry) => entry.current);

  const toggle = useMutation({
    mutationFn: (item: IssueChecklistItem) =>
      setChecklistItem(
        api,
        issueId,
        current?.statusKey ?? '',
        item.itemKey,
        !item.checked,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: npKeys.issueChecklists(issueId),
      });
      void queryClient.invalidateQueries({ queryKey: npKeys.issue(issueId) });
    },
    onError: () =>
      toast.add({
        type: 'error',
        priority: 'high',
        title: t('np.common.requestFailed'),
      }),
  });

  if (!current || current.items.length === 0) return null;

  return (
    <Card size='sm' role='region' aria-labelledby='np-checklist-title'>
      <CardHeader>
        <CardTitle id='np-checklist-title'>{t('np.checklist.title')}</CardTitle>
        <CardDescription>
          {current.complete
            ? t('np.checklist.complete')
            : t('np.checklist.incomplete')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className='space-y-2'>
          {current.items.map((item) => (
            <li key={item.itemKey} className='flex items-start gap-2 text-sm'>
              <Checkbox
                id={`np-checklist-${item.itemKey}`}
                checked={item.checked}
                disabled={toggle.isPending}
                onCheckedChange={() => toggle.mutate(item)}
              />
              <label
                htmlFor={`np-checklist-${item.itemKey}`}
                className='min-w-0 flex-1 wrap-anywhere'
              >
                {item.label}
                {item.required ? (
                  <span
                    className='ml-1 text-destructive'
                    aria-label={t('np.checklist.required')}
                  >
                    *
                  </span>
                ) : null}
              </label>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
