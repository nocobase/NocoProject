import type { ApiClient } from '@nocobase/app-client';

import { unwrap, unwrapList } from './api-iter2.js';
import type {
  IssueChecklist,
  WorkflowListItemV5,
  WorkflowProposal,
  WorkflowRevision,
} from './types-phase2.js';

/**
 * Request functions for Phase 2 stage 1 (NP-81, checklists) and stage 2 (NP-82, workflow template proposals and
 * revision history). The proposal decision itself (accept/reject) runs through the generic decision runner
 * (`decision/use-decision.ts`), which follows the `payload.actions` paths the server sends on the `workflow_proposal`
 * inbox item — there is no bespoke accept/reject request here.
 */

const id = (value: string): string => encodeURIComponent(value);

// ---------- workflow templates (stage 1 + 2 shape) ----------

export async function fetchWorkflowTemplateV5(
  api: ApiClient,
  workflowId: string,
  signal?: AbortSignal,
): Promise<WorkflowListItemV5> {
  return unwrap<WorkflowListItemV5>(
    await api.request<unknown>({
      path: `np/workflows/${id(workflowId)}`,
      signal,
    }),
  );
}

export async function fetchWorkflowRevisions(
  api: ApiClient,
  workflowId: string,
  signal?: AbortSignal,
): Promise<WorkflowRevision[]> {
  return unwrapList<WorkflowRevision>(
    await api.request<unknown>({
      path: `np/workflows/${id(workflowId)}/revisions`,
      signal,
    }),
  );
}

// ---------- workflow template proposals (decision card) ----------

export async function fetchWorkflowProposal(
  api: ApiClient,
  proposalId: string,
  signal?: AbortSignal,
): Promise<WorkflowProposal> {
  return unwrap<WorkflowProposal>(
    await api.request<unknown>({
      path: `np/workflows/proposals/${id(proposalId)}`,
      signal,
    }),
  );
}

// ---------- issue checklists ----------

export async function fetchIssueChecklists(
  api: ApiClient,
  issueId: string,
  signal?: AbortSignal,
): Promise<IssueChecklist[]> {
  return unwrapList<IssueChecklist>(
    await api.request<unknown>({
      path: `np/issues/${id(issueId)}/checklists`,
      signal,
    }),
  );
}

export async function setChecklistItem(
  api: ApiClient,
  issueId: string,
  statusKey: string,
  itemKey: string,
  checked: boolean,
): Promise<IssueChecklist> {
  return unwrap<IssueChecklist>(
    await api.request<unknown, { checked: boolean }>({
      path: `np/issues/${id(issueId)}/checklists/${id(statusKey)}/items/${id(itemKey)}`,
      method: 'PATCH',
      json: { checked },
    }),
  );
}
