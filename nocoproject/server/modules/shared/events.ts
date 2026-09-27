// @temporary(nocobase-official): 待替换为 NocoBase 官方 活动流与变更事件
/**
 * In-process domain event bus.
 *
 * Services record what changed; subscribers (today only the realtime bridge) turn that into side effects. Events are
 * emitted after the owning transaction commits (see `shared/db.ts`), so a subscriber never observes a change that
 * is later rolled back. Delivery is synchronous, in-process and best-effort: a failing subscriber is logged and does
 * not affect the caller or the other subscribers. It does not survive a restart and does not cross instances.
 *
 * Before the commit, the same events are handed to the notification module inside the transaction (the
 * `beforeCommit` hook of `createTxRunner`); the `issue.*`, `comment.*`, `proposal.*` and `run.failed` events below
 * exist for it. The inbox they feed is not temporary; only this bus is.
 */
import type { DependencyType, ExecutorType, RunStatus } from './protocol.js';

/** Who caused an event, in serializable form. */
export interface EventActor {
  readonly type: 'user' | 'agent' | 'system';
  readonly id: string | null;
}

export interface ExecutorRef {
  readonly type: ExecutorType;
  readonly id: string | null;
}

/** What one issue write changed, for the notification module. */
export interface IssueChangeSet {
  readonly status?: { readonly from: string; readonly to: string };
  readonly owner?: { readonly from: string | null; readonly to: string | null };
  readonly executor?: { readonly from: ExecutorRef; readonly to: ExecutorRef };
  /** Users newly mentioned in the description. */
  readonly mentionedUserIds?: readonly string[];
}

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
    }
  | {
      readonly type: 'issue.created';
      readonly issueId: string;
      readonly actor: EventActor;
      readonly mentionedUserIds: readonly string[];
    }
  | {
      readonly type: 'issue.updated';
      readonly issueId: string;
      readonly actor: EventActor;
      readonly changes: IssueChangeSet;
    }
  | {
      readonly type: 'comment.created';
      readonly issueId: string;
      readonly commentId: string;
      readonly actor: EventActor;
      readonly mentionedUserIds: readonly string[];
    }
  | {
      readonly type: 'run.failed';
      readonly runId: string;
      readonly issueId: string;
      readonly agentId: string;
      readonly reason: string;
      /** No retry was scheduled. */
      readonly final: boolean;
    }
  | {
      readonly type: 'proposal.created';
      readonly proposalId: string;
      readonly issueId: string;
      readonly parentIssueId: string | null;
      readonly proposedByAgentId: string;
      readonly proposedAgentId: string;
    }
  | {
      readonly type: 'proposal.decided';
      readonly proposalId: string;
      readonly issueId: string;
      readonly parentIssueId: string | null;
      readonly actor: EventActor;
    }
  | {
      readonly type: 'issue.batchDone';
      readonly parentIssueId: string;
      readonly stage: number | null;
      readonly childIssueIds: readonly string[];
    }
  | {
      readonly type: 'issue.dependencyReleased';
      readonly issueId: string;
      readonly releasedBy: string;
    }
  | {
      readonly type: 'issue.dependencyChanged';
      readonly issueId: string;
      readonly dependsOnIssueId: string;
      readonly dependencyType: DependencyType;
      readonly added: boolean;
    }
  | { readonly type: 'inbox.changed'; readonly userId: string };

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
