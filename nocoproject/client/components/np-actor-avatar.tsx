import { useTranslation } from '@nocobase/i18n/client';
import { BotIcon, CogIcon } from 'lucide-react';
import type { ReactElement } from 'react';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { initials } from '@/pages/np/format';

export type NpActorKind = 'user' | 'agent' | 'system' | 'none';

export interface NpActorAvatarProps {
  readonly type: NpActorKind;
  readonly name?: string | null;
  /** `xs` sits inline with text (16px), `sm` in lists (24px), `default` in headers (32px). */
  readonly size?: 'xs' | 'sm' | 'default';
  /** Renders the name beside the avatar. */
  readonly showName?: boolean;
  /**
   * An avatar next to a visible name is decorative (the default). A standalone avatar sets `false` and is announced
   * as "name (kind)".
   */
  readonly decorative?: boolean;
  readonly className?: string;
}

/**
 * The one avatar for people, agents and the system across NocoProject (§H 4). A person shows initials, an agent a
 * bot on the secondary surface, the system a cog; the kind is repeated as screen-reader text so it does not rest on
 * the picture alone.
 */
export function NpActorAvatar({
  type,
  name,
  size = 'sm',
  showName = false,
  decorative = true,
  className,
}: NpActorAvatarProps): ReactElement {
  const { t } = useTranslation();
  const label =
    type === 'agent'
      ? t('np.actor.agent')
      : type === 'system'
        ? t('np.actor.system')
        : t('np.actor.user');
  const avatar = (
    <Avatar
      size={size === 'default' ? 'default' : 'sm'}
      data-actor={type}
      className={cn(size === 'xs' && 'size-4', !showName && className)}
      {...(decorative || showName
        ? { 'aria-hidden': true }
        : { role: 'img', 'aria-label': `${name ?? '—'} (${label})` })}
      title={name ?? undefined}
    >
      <AvatarFallback
        className={cn(
          size === 'xs' && 'text-[0.5rem]',
          type === 'agent' && 'bg-secondary text-secondary-foreground',
        )}
      >
        {type === 'agent' ? (
          <BotIcon
            className={size === 'xs' ? 'size-2.5' : 'size-3.5'}
            aria-hidden='true'
          />
        ) : type === 'system' ? (
          <CogIcon
            className={size === 'xs' ? 'size-2.5' : 'size-3.5'}
            aria-hidden='true'
          />
        ) : (
          <span aria-hidden='true'>{initials(name ?? '?')}</span>
        )}
      </AvatarFallback>
    </Avatar>
  );
  if (!showName) return avatar;
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5', className)}>
      {avatar}
      <span className='truncate'>{name ?? '—'}</span>
      <span className='sr-only'>{`(${label})`}</span>
    </span>
  );
}
