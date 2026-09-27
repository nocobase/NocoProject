import { useTranslation } from '@nocobase/i18n/client';
import { BotIcon } from 'lucide-react';
import { type ReactElement, type RefObject, useId, useState } from 'react';

import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

import { isRuntimeOnline } from '../../constants.js';
import type { AgentListItem } from '../../types.js';
import { findMentionQuery, insertMention } from '../mentions.js';

export interface MentionTextareaProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly agents: readonly AgentListItem[];
  readonly textareaRef: RefObject<HTMLTextAreaElement | null>;
  /** ⌘/Ctrl + Enter while the picker is closed. */
  readonly onSubmit: () => void;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly 'aria-label'?: string;
}

const MAX_SUGGESTIONS = 8;

/**
 * A textarea with an `@` agent picker. Typing `@` (at the start or after whitespace) lists agents filtered by what
 * follows; Arrow keys move, Enter or Tab inserts `[@Name](mention://agent/<id>)`, Escape dismisses. Focus stays in
 * the textarea throughout, so the list is a listbox driven by `aria-activedescendant` rather than a popover that
 * would take focus.
 */
export function MentionTextarea({
  value,
  onChange,
  agents,
  textareaRef,
  onSubmit,
  placeholder,
  disabled,
  'aria-label': ariaLabel,
}: MentionTextareaProps): ReactElement {
  const { t } = useTranslation();
  const listId = useId();
  const [caret, setCaret] = useState<number | null>(null);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [active, setActive] = useState<{
    readonly key: string;
    readonly index: number;
  }>({ key: '', index: 0 });

  const mention = caret === null ? null : findMentionQuery(value, caret);
  const open = mention !== null && mention.start !== dismissedAt && !disabled;
  const needle = mention?.query.toLowerCase() ?? '';
  const matches = open
    ? agents
        .filter((agent) => agent.name.toLowerCase().includes(needle))
        .slice(0, MAX_SUGGESTIONS)
    : [];
  const queryKey = mention ? `${mention.start}:${mention.query}` : '';
  const activeIndex =
    active.key === queryKey
      ? Math.min(active.index, Math.max(matches.length - 1, 0))
      : 0;

  function syncCaret(element: HTMLTextAreaElement): void {
    setCaret(element.selectionStart);
  }

  function choose(agent: AgentListItem): void {
    if (caret === null) return;
    const next = insertMention(value, caret, agent);
    onChange(next.text);
    setCaret(next.caret);
    // Restore focus and the caret after React commits the new value.
    requestAnimationFrame(() => {
      const element = textareaRef.current;
      if (!element) return;
      element.focus();
      element.setSelectionRange(next.caret, next.caret);
    });
  }

  return (
    <div className='relative'>
      {open ? (
        <div
          id={listId}
          role='listbox'
          aria-label={t('np.comment.mentionList')}
          className='absolute bottom-full left-0 z-20 mb-1 w-72 max-w-full overflow-hidden rounded-lg bg-popover p-1 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10'
        >
          {matches.length === 0 ? (
            <p className='px-2 py-1.5 text-muted-foreground'>
              {t('np.comment.noAgents')}
            </p>
          ) : (
            matches.map((agent, index) => (
              <div
                key={agent.id}
                id={`${listId}-${agent.id}`}
                role='option'
                aria-selected={index === activeIndex}
                className={cn(
                  'flex cursor-default items-center gap-2 rounded-md px-2 py-1.5',
                  index === activeIndex && 'bg-accent text-accent-foreground',
                )}
                onMouseDown={(event) => {
                  // Keep focus in the textarea; the click would otherwise blur it first.
                  event.preventDefault();
                  choose(agent);
                }}
                onMouseEnter={() => setActive({ key: queryKey, index })}
              >
                <BotIcon
                  className='size-3.5 text-muted-foreground'
                  aria-hidden='true'
                />
                <span className='truncate'>{agent.name}</span>
                <span className='ml-auto text-xs text-muted-foreground'>
                  {isRuntimeOnline(agent)
                    ? t('np.common.online')
                    : t('np.common.offline')}
                </span>
              </div>
            ))
          )}
        </div>
      ) : null}
      <Textarea
        ref={textareaRef}
        value={value}
        rows={3}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={ariaLabel}
        role='combobox'
        aria-autocomplete='list'
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={
          open && matches[activeIndex]
            ? `${listId}-${matches[activeIndex].id}`
            : undefined
        }
        className='max-h-64 resize-none'
        onChange={(event) => {
          onChange(event.target.value);
          syncCaret(event.target);
        }}
        onSelect={(event) => syncCaret(event.currentTarget)}
        onBlur={() => setCaret(null)}
        onKeyDown={(event) => {
          if (open && !event.nativeEvent.isComposing) {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              const step = event.key === 'ArrowDown' ? 1 : -1;
              const count = Math.max(matches.length, 1);
              setActive({
                key: queryKey,
                index: (activeIndex + step + count) % count,
              });
              return;
            }
            if (
              (event.key === 'Enter' || event.key === 'Tab') &&
              matches[activeIndex]
            ) {
              event.preventDefault();
              choose(matches[activeIndex]);
              return;
            }
            if (event.key === 'Escape' && mention) {
              event.preventDefault();
              event.stopPropagation();
              setDismissedAt(mention.start);
              return;
            }
          }
          if (
            event.key === 'Enter' &&
            (event.metaKey || event.ctrlKey) &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault();
            onSubmit();
          }
        }}
      />
    </div>
  );
}
