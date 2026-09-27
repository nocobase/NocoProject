import { ApiClientError, useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { AlertCircleIcon } from 'lucide-react';
import { type ReactElement, useMemo } from 'react';

import { DataTable } from '@/components/data-table';
import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';

import { fetchMembers, updateMemberRole } from '../api-collab.js';
import { fetchMe } from '../api.js';
import { npKeys } from '../constants.js';
import { initials } from '../format.js';
import {
  type Viewer,
  canChangeMemberRole,
  memberRoleOptions,
  viewerFrom,
} from '../permissions.js';
import type { Member, MemberRole } from '../types.js';

function RoleSelect({
  member,
  members,
  viewer,
  busy,
  onChange,
}: {
  readonly member: Member;
  readonly members: readonly Member[];
  readonly viewer: Viewer | null;
  readonly busy: boolean;
  readonly onChange: (role: MemberRole) => void;
}): ReactElement {
  const { t } = useTranslation();
  const options = memberRoleOptions(viewer, member, members);
  const items = options.map((option) => ({
    value: option.value,
    label: t(`np.members.role.${option.value}`),
  }));
  return (
    <Select
      items={items}
      value={member.role}
      disabled={busy || !canChangeMemberRole(viewer, member, members)}
      onValueChange={(value: MemberRole | null) => {
        if (value && value !== member.role) onChange(value);
      }}
    >
      <SelectTrigger
        size='sm'
        className='w-32'
        aria-label={t('np.members.roleFor', { name: member.name })}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            disabled={option.disabled}
          >
            {t(`np.members.role.${option.value}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Settings route `/settings/members` (§J 6): the workspace members and their roles. Everyone listed can open it,
 * but only owner/admin change roles, only an owner grants or revokes owner, and the last owner keeps the role
 * (`memberRoleOptions`); `PATCH /np/members/:userId` enforces the same rules.
 */
export default function MembersSettingsPage(): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const members = useQuery({
    queryKey: npKeys.members,
    queryFn: () => fetchMembers(api),
  });
  const me = useQuery({ queryKey: npKeys.me, queryFn: () => fetchMe(api) });
  const viewer = viewerFrom(me.data?.userId, members.data);

  const change = useMutation({
    mutationFn: ({ member, role }: { member: Member; role: MemberRole }) =>
      updateMemberRole(api, member.userId, role),
    onSuccess: (_, { member, role }) =>
      toast.add({
        type: 'success',
        title: t('np.members.roleChanged', {
          name: member.name,
          role: t(`np.members.role.${role}`),
        }),
      }),
    onError: (error: unknown) =>
      toast.add({
        type: 'error',
        priority: 'high',
        title:
          error instanceof ApiClientError && error.status === 403
            ? t('np.members.forbidden')
            : t('np.common.requestFailed'),
      }),
    onSettled: () =>
      void queryClient.invalidateQueries({ queryKey: npKeys.members }),
  });

  const rows = members.data;
  const columns = useMemo<ColumnDef<Member, unknown>[]>(
    () => [
      {
        accessorKey: 'name',
        header: t('np.members.columns.name'),
        cell: ({ row }) => (
          <div className='flex items-center gap-2'>
            <Avatar size='sm'>
              <AvatarFallback>{initials(row.original.name)}</AvatarFallback>
            </Avatar>
            <span className='font-medium'>{row.original.name}</span>
            {row.original.userId === viewer?.userId ? (
              <span className='text-xs text-muted-foreground'>
                {t('np.properties.you')}
              </span>
            ) : null}
          </div>
        ),
      },
      {
        accessorKey: 'email',
        header: t('np.members.columns.email'),
        cell: ({ row }) => (
          <span className='text-sm text-muted-foreground'>
            {row.original.email ?? '—'}
          </span>
        ),
      },
      {
        accessorKey: 'role',
        header: t('np.members.columns.role'),
        cell: ({ row }) => (
          <RoleSelect
            member={row.original}
            members={rows ?? []}
            viewer={viewer}
            busy={change.isPending}
            onChange={(role) => change.mutate({ member: row.original, role })}
          />
        ),
      },
    ],
    [t, viewer, rows, change],
  );

  let content: ReactElement;
  if (members.isError && !rows) {
    const forbidden =
      members.error instanceof ApiClientError && members.error.status === 403;
    content = (
      <Alert variant='destructive'>
        <AlertCircleIcon />
        <AlertTitle>{t('np.members.loadFailed')}</AlertTitle>
        <AlertDescription>
          {forbidden ? t('np.common.forbidden') : t('np.common.requestFailed')}
        </AlertDescription>
        {forbidden ? null : (
          <AlertAction>
            <Button
              variant='outline'
              size='sm'
              onClick={() => void members.refetch()}
            >
              {t('status.retry')}
            </Button>
          </AlertAction>
        )}
      </Alert>
    );
  } else if (!rows) {
    content = (
      <div
        role='status'
        aria-label={t('status.loading')}
        className='space-y-2 rounded-lg border p-4'
      >
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className='h-8 w-full' />
        ))}
      </div>
    );
  } else {
    content = (
      <DataTable
        columns={columns}
        data={rows}
        pageSize={50}
        showSelectedCount={false}
        getRowId={(member) => member.userId}
      />
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title={t('np.members.title')}
        description={t('np.members.description')}
      />
      {content}
    </PageContainer>
  );
}
