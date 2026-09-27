/** The query string to return to when batch entry closes: the page's own filters, without the drawer's parameters. */
export function intakeCloseSearch(search: string): string {
  const params = new URLSearchParams(search);
  params.delete('batch');
  params.delete('project');
  const rest = params.toString();
  return rest ? `?${rest}` : '';
}

/**
 * Where an old `/intake` link goes (iteration 3 §G): the drawer over the issue list, or over the project when
 * `?project=` names one, keeping `?batch=`.
 */
export function intakeRedirectTarget(search: string): string {
  const params = new URLSearchParams(search);
  const projectId = params.get('project');
  const batch = params.get('batch');
  const next = new URLSearchParams();
  if (batch) next.set('batch', batch);
  const query = next.toString() ? `?${next.toString()}` : '';
  return projectId
    ? `/projects/${encodeURIComponent(projectId)}/intake${query}`
    : `/issues/intake${query}`;
}
