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
 * exist for it, and so do the iteration 2 `approval.*` and `pr.*` events. The inbox they feed is not temporary; only
 * this bus is.
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
  | { readonly type: 'inbox.changed'; readonly userId: string }
  // Iteration 2 (docs/phase1/iteration-2-contract.md §C, §D).
  | {
      readonly type: 'approval.requested';
      readonly requestId: string;
      readonly issueId: string;
      readonly fromStatus: string;
      readonly toStatus: string;
      readonly approverUserIds: readonly string[];
      readonly actor: EventActor;
    }
  | {
      readonly type: 'approval.decided';
      readonly requestId: string;
      readonly issueId: string;
      readonly status: 'approved' | 'rejected' | 'cancelled';
      readonly fromStatus: string;
      readonly toStatus: string;
      readonly requestedBy: EventActor;
      /** The approver; system for a cancellation. */
      readonly actor: EventActor;
      readonly comment: string | null;
    }
  | {
      readonly type: 'pr.reviewRequested';
      readonly issueId: string;
      readonly pullRequestId: string;
      readonly repo: string;
      readonly number: number;
      readonly url: string;
    }
  | {
      /** A PR was merged or closed: its `pr_review` cards resolve. */
      readonly type: 'pr.closed';
      readonly issueIds: readonly string[];
      readonly merged: boolean;
    }
  | {
      readonly type: 'pr.merged';
      readonly issueId: string;
      readonly repo: string;
      readonly number: number;
      readonly url: string;
      /** The status the merge moved the issue to, or null when it did not change it. */
      readonly statusChangedTo: string | null;
    }
  // Iteration 3 (docs/phase1/iteration-3-contract.md §B, §E). Knowledge events carry everything the inbox payload
  // needs, so the notification module never reads the knowledge tables.
  | {
      readonly type: 'knowledge.proposed';
      readonly proposalId: string;
      readonly docId: string | null;
      readonly docTitle: string;
      readonly projectId: string | null;
      readonly projectName: string | null;
      readonly reason: string;
      readonly summary: string;
      readonly isNew: boolean;
      /** The source issue (the card is shown on it); null skips the card. */
      readonly issueId: string | null;
      readonly deciderUserIds: readonly string[];
      readonly actor: EventActor;
    }
  | {
      readonly type: 'knowledge.decided';
      readonly proposalId: string;
      readonly docId: string | null;
      readonly docTitle: string;
      readonly decision: 'accepted' | 'rejected';
      /** The document version the acceptance produced (null when rejected). */
      readonly version: number | null;
      readonly comment: string | null;
      readonly issueId: string | null;
      readonly actor: EventActor;
    }
  | {
      /** A member accepted a delivery or asked for changes: the issue's `review_requested` cards resolve. */
      readonly type: 'delivery.decided';
      readonly issueId: string;
      readonly decision: 'accepted' | 'changesRequested';
      readonly actor: EventActor;
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
