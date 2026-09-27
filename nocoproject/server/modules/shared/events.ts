// @temporary(nocobase-official): 待替换为 NocoBase 官方 活动流与变更事件
/**
 * In-process domain event bus.
 *
 * Services record what changed; subscribers (today only the realtime bridge) turn that into side effects. Events are
 * emitted after the owning transaction commits (see `shared/db.ts`), so a subscriber never observes a change that
 * is later rolled back. Delivery is synchronous, in-process and best-effort: a failing subscriber is logged and does
 * not affect the caller or the other subscribers. It does not survive a restart and does not cross instances.
 */
import type { RunStatus } from './protocol.js';

export type DomainEvent =
  | { readonly type: 'issue.changed'; readonly issueId: string }
  | {
      readonly type: 'run.status';
      readonly runId: string;
      readonly issueId: string;
      readonly status: RunStatus;
    }
  | {
      readonly type: 'run.events';
      readonly runId: string;
      readonly last: number;
    }
  | { readonly type: 'agents.changed' }
  | {
      readonly type: 'daemon.workAvailable';
      readonly userId: string;
      readonly runtimeId: string;
    }
  | {
      readonly type: 'daemon.cancelRequested';
      readonly userId: string;
      readonly runId: string;
    };

export type DomainEventListener = (event: DomainEvent) => void;

export interface DomainEventBus {
  emit(event: DomainEvent): void;
  subscribe(listener: DomainEventListener): () => void;
}

export function createDomainEventBus(
  onError: (error: unknown, event: DomainEvent) => void = (error) =>
    console.error('NocoProject domain event listener failed.', error),
): DomainEventBus {
  const listeners = new Set<DomainEventListener>();
  return {
    emit(event) {
      for (const listener of Array.from(listeners)) {
        try {
          listener(event);
        } catch (error) {
          onError(error, event);
        }
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
