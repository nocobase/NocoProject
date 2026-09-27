import type { ApiClient } from '@nocobase/app-client';

import {
  normalizeIssueDetail,
  type RawIssueDetail,
} from './detail-normalize.js';
import type {
  AgentListItem,
  CreateAgentInput,
  CreateCommentResult,
  CreateIssueInput,
  Issue,
  IssueDetail,
  IssueListItem,
  Me,
  Project,
  RunEventsResponse,
  RunSummary,
  Runtime,
  UpdateIssueInput,
} from './types.js';

/**
 * Plain request functions for the browser API in protocol §3. Paths are relative to the application API base, which
 * already carries `/api` and the deployment base path.
 */

const id = (value: string): string => encodeURIComponent(value);

export async function fetchMe(api: ApiClient): Promise<Me> {
  const { data } = await api.request<{ data: Me }>({ path: 'np/me' });
  return data;
}

export async function fetchProjects(api: ApiClient): Promise<Project[]> {
  const { data } = await api.request<{ data: Project[] }>({
    path: 'np/projects',
  });
  return data;
}

export async function fetchIssues(
  api: ApiClient,
  filters: { readonly statusKey?: string; readonly q?: string },
  signal?: AbortSignal,
): Promise<IssueListItem[]> {
  const { data } = await api.request<{ data: IssueListItem[] }>({
    path: 'np/issues',
    query: {
      statusKey: filters.statusKey || undefined,
      q: filters.q || undefined,
    },
    signal,
  });
  return data;
}

export async function createIssue(
  api: ApiClient,
  input: CreateIssueInput,
): Promise<Issue> {
  const { data } = await api.request<{ data: Issue }, CreateIssueInput>({
    path: 'np/issues',
    method: 'POST',
    json: input,
  });
  return data;
}

export async function fetchIssueDetail(
  api: ApiClient,
  issueId: string,
  signal?: AbortSignal,
): Promise<IssueDetail> {
  const { data } = await api.request<{ data: RawIssueDetail }>({
    path: `np/issues/${id(issueId)}`,
    signal,
  });
  return normalizeIssueDetail(data);
}

/** PATCH with optimistic concurrency: a stale `revision` answers 409 `REVISION_CONFLICT`. */
export async function updateIssue(
  api: ApiClient,
  issueId: string,
  changes: UpdateIssueInput,
  revision: number,
): Promise<Issue> {
  const { data } = await api.request<
    { data: Issue },
    UpdateIssueInput & { revision: number }
  >({
    path: `np/issues/${id(issueId)}`,
    method: 'PATCH',
    json: { ...changes, revision },
  });
  return data;
}

export async function createComment(
  api: ApiClient,
  issueId: string,
  input: { readonly content: string; readonly parentId?: string },
): Promise<CreateCommentResult> {
  const { data } = await api.request<
    { data: CreateCommentResult },
    { content: string; parentId?: string }
  >({
    path: `np/issues/${id(issueId)}/comments`,
    method: 'POST',
    json: input,
  });
  return data;
}

export async function fetchAgents(api: ApiClient): Promise<AgentListItem[]> {
  const { data } = await api.request<{ data: AgentListItem[] }>({
    path: 'np/agents',
  });
  return data;
}

export async function createAgent(
  api: ApiClient,
  input: CreateAgentInput,
): Promise<AgentListItem> {
  const { data } = await api.request<{ data: AgentListItem }, CreateAgentInput>(
    { path: 'np/agents', method: 'POST', json: input },
  );
  return data;
}

export async function fetchRuntimes(api: ApiClient): Promise<Runtime[]> {
  const { data } = await api.request<{ data: Runtime[] }>({
    path: 'np/runtimes',
  });
  return data;
}

export async function fetchRun(
  api: ApiClient,
  runId: string,
): Promise<RunSummary> {
  const { data } = await api.request<{ data: RunSummary }>({
    path: `np/runs/${id(runId)}`,
  });
  return data;
}

/** Events after `since`; the first request omits it and receives the run's events from the start. */
export async function fetchRunEvents(
  api: ApiClient,
  runId: string,
  since: number | undefined,
): Promise<RunEventsResponse> {
  return api.request<RunEventsResponse>({
    path: `np/runs/${id(runId)}/events`,
    query: { since },
  });
}

export async function cancelRun(api: ApiClient, runId: string): Promise<void> {
  await api.request<unknown>({
    path: `np/runs/${id(runId)}/cancel`,
    method: 'POST',
  });
}

export async function retryRun(
  api: ApiClient,
  runId: string,
): Promise<RunSummary> {
  const { data } = await api.request<{ data: RunSummary }>({
    path: `np/runs/${id(runId)}/retry`,
    method: 'POST',
  });
  return data;
}
