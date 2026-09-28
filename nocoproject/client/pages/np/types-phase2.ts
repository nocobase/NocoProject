/**
 * Browser-side types for Phase 2 stage 1 (NP-81, `docs/phase2/protocol-workflow-stage-actions.md`) and stage 2
 * (NP-82, `docs/phase2/protocol-workflow-proposals.md`). Copied from the server's protocol files for the same reason
 * as `types.ts`: the client tsconfig must not reach into `server/`.
 */
import type { ActorType, StatusCategory } from './types.js';
import type { LabelColor, Workflow } from './types-collab.js';
import type { WorkflowDefinitionV3 } from './types-iter3.js';

// ---------- 阶段动作（NP-81 §1） ----------

export type StageActionType =
  | 'notifyOwner'
  | 'runExecutor'
  | 'suggestExecutor'
  | 'checklist'
  | 'requirePrMerged'
  | 'automation';

export interface StageChecklistItemDefinition {
  readonly key: string;
  readonly label: string;
  readonly required: boolean;
}

export type StageAction =
  | { readonly type: 'notifyOwner'; readonly message?: string }
  | {
      readonly type: 'runExecutor';
      readonly agentId?: string | null;
      readonly instruction?: string;
    }
  | {
      readonly type: 'suggestExecutor';
      readonly agentId: string;
      readonly reason?: string;
    }
  | {
      readonly type: 'checklist';
      readonly items: readonly StageChecklistItemDefinition[];
    }
  | { readonly type: 'requirePrMerged'; readonly minCount?: number }
  | { readonly type: 'automation'; readonly workflowKey: string };

/** Stage actions that gate entry (409 when not satisfied); every other type is an effect run after the move. */
export const STAGE_GUARD_TYPES: ReadonlySet<StageActionType> = new Set([
  'requirePrMerged',
]);

export interface WorkflowStatusDefinitionV5 {
  readonly key: string;
  readonly name: string;
  readonly category: StatusCategory;
  readonly color: LabelColor;
  readonly builtIn: boolean;
  readonly onEnter?: readonly StageAction[];
}

export interface WorkflowDefinitionV5 extends Omit<
  WorkflowDefinitionV3,
  'statuses'
> {
  readonly statuses: readonly WorkflowStatusDefinitionV5[];
}

/** `GET /np/workflows[/:id]`: the template with its revision and system-template marker (stage 2 §2). */
export interface WorkflowListItemV5 extends Omit<Workflow, 'definition'> {
  readonly definition: WorkflowDefinitionV5;
  readonly revision: number;
  readonly isSystem: boolean;
  readonly projectCount?: number;
}

/** `GET /np/workflows/:id/revisions` row, newest first. */
export interface WorkflowRevision {
  readonly revision: number;
  readonly name: string;
  readonly definition: WorkflowDefinitionV5;
  readonly proposalId: string | null;
  readonly note: string | null;
  readonly createdByType: ActorType;
  readonly createdById: string | null;
  readonly createdByName: string | null;
  readonly createdAt: string;
}

// ---------- 检查清单（NP-81 §6） ----------

export interface IssueChecklistItem {
  readonly itemKey: string;
  readonly label: string;
  readonly required: boolean;
  readonly checked: boolean;
  readonly checkedByType: 'user' | 'agent' | null;
  readonly checkedById: string | null;
  readonly checkedByName: string | null;
  readonly checkedAt: string | null;
}

export interface IssueChecklist {
  readonly statusKey: string;
  readonly current: boolean;
  readonly complete: boolean;
  readonly items: readonly IssueChecklistItem[];
}

// ---------- 提议与差异摘要（NP-82 §4–§5） ----------

export type WorkflowProposalKind = 'update' | 'copy';
export type WorkflowProposalStatus =
  'pending' | 'accepted' | 'rejected' | 'stale';

export interface WorkflowDiffStatus {
  readonly key: string;
  readonly name: string;
  readonly category: string;
}

export interface WorkflowDiffTransition {
  readonly from: string;
  readonly to: string;
  readonly actors: readonly string[];
  readonly approvers: readonly string[] | null;
}

export interface WorkflowDiffChange<T> {
  readonly from: T;
  readonly to: T;
}

export interface WorkflowDiff {
  readonly statuses: {
    readonly added: readonly WorkflowDiffStatus[];
    readonly removed: readonly WorkflowDiffStatus[];
    readonly changed: readonly {
      readonly key: string;
      readonly name?: WorkflowDiffChange<string>;
      readonly color?: WorkflowDiffChange<string>;
    }[];
    readonly order?: WorkflowDiffChange<readonly string[]>;
  };
  readonly transitions: {
    readonly added: readonly WorkflowDiffTransition[];
    readonly removed: readonly WorkflowDiffTransition[];
    readonly changed: readonly {
      readonly from: string;
      readonly to: string;
      readonly actors?: WorkflowDiffChange<readonly string[]>;
      readonly approvers?: WorkflowDiffChange<readonly string[] | null>;
    }[];
  };
  readonly actions: readonly {
    readonly statusKey: string;
    readonly added: readonly StageAction[];
    readonly removed: readonly StageAction[];
  }[];
  readonly runExecutorAgents: readonly {
    readonly statusKey: string;
    readonly agentId: string;
    readonly agentName: string | null;
    readonly isNew: boolean;
  }[];
  readonly childBatchDoneWakesParentExecutor?: WorkflowDiffChange<boolean>;
  readonly name?: WorkflowDiffChange<string>;
  readonly empty: boolean;
}

/** `GET /np/workflows/proposals/:id` */
export interface WorkflowProposal {
  readonly id: string;
  readonly kind: WorkflowProposalKind;
  readonly templateId: string | null;
  readonly templateName: string | null;
  readonly copyFromId: string | null;
  readonly copyFromName: string | null;
  readonly name: string | null;
  readonly reason: string;
  readonly baseRevision: number;
  readonly currentRevision: number | null;
  readonly outdated: boolean;
  readonly definition: WorkflowDefinitionV5;
  readonly diff: WorkflowDiff;
  readonly affectedProjectCount: number;
  readonly proposedByAgentId: string;
  readonly proposedByAgentName: string | null;
  readonly sourceRunId: string | null;
  readonly sourceIssueId: string | null;
  readonly sourceIssueIdentifier: string | null;
  readonly status: WorkflowProposalStatus;
  readonly decidedById: string | null;
  readonly decidedByName: string | null;
  readonly decidedAt: string | null;
  readonly comment: string | null;
  readonly resultRevision: number | null;
  readonly canDecide: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}
