/**
 * The "new issue" dialog as data: where it goes when it closes, and where the old batch-entry links now land.
 * NP-186: the AI draft tab is gone, so the dialog is the manual form only.
 */

/** The query string to return to on close: the list's own filters (the project stays), without the dialog's. */
export function newIssueCloseSearch(search: string): string {
  const params = new URLSearchParams(search);
  // Old links may still carry the retired AI tab's parameters.
  params.delete('tab');
  params.delete('batch');
  const rest = params.toString();
  return rest ? `?${rest}` : '';
}

/**
 * Where an old batch-entry link goes (`/intake`, `/issues/intake`, `/projects/:projectId/intake`): the manual form
 * over the issue list, the project preselected.
 */
export function newIssueRedirectTarget(
  search: string,
  projectId?: string | null,
): string {
  const project = projectId ?? new URLSearchParams(search).get('project');
  return project
    ? `/issues/new?${new URLSearchParams({ project }).toString()}`
    : '/issues/new';
}
