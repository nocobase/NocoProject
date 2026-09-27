import { useLocale } from '@nocobase/i18n/client';
import { useMemo } from 'react';

export interface NpFormatters {
  /** Date and time in the current language, or "—" for an empty value. */
  readonly dateTime: (iso: string | null | undefined) => string;
  /** Time of day only, for transcript rows. */
  readonly time: (iso: string | null | undefined) => string;
  /** "3 minutes ago" in the current language. */
  readonly relative: (iso: string | null | undefined) => string;
}

const UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
  ['second', 1],
];

/** Formatters that follow the interface language (created per locale, not per render). */
export function useNpFormatters(): NpFormatters {
  const { locale } = useLocale();
  return useMemo(() => {
    const dateTime = new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
    const time = new Intl.DateTimeFormat(locale, { timeStyle: 'medium' });
    const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    const parse = (iso: string | null | undefined): Date | null => {
      if (!iso) return null;
      const date = new Date(iso);
      return Number.isNaN(date.getTime()) ? null : date;
    };
    return {
      dateTime: (iso) => {
        const date = parse(iso);
        return date ? dateTime.format(date) : '—';
      },
      time: (iso) => {
        const date = parse(iso);
        return date ? time.format(date) : '—';
      },
      relative: (iso) => {
        const date = parse(iso);
        if (!date) return '—';
        const seconds = Math.round((date.getTime() - Date.now()) / 1000);
        for (const [unit, size] of UNITS) {
          if (Math.abs(seconds) >= size || unit === 'second') {
            return relative.format(Math.round(seconds / size), unit);
          }
        }
        return relative.format(0, 'second');
      },
    };
  }, [locale]);
}

/** Seconds between two instants as "1m 05s" style text, or null when either end is missing. */
export function durationText(
  from: string | null | undefined,
  to: string | null | undefined,
): string | null {
  if (!from || !to) return null;
  const ms = new Date(to).getTime() - new Date(from).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes > 0
    ? `${minutes}m ${String(seconds).padStart(2, '0')}s`
    : `${seconds}s`;
}
