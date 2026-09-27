# NocoProject pages: UI rules

These rules come from iteration 3 §H (`docs/phase1/iteration-3-contract.md`). Every page under `client/pages/np/` follows them; a page that does not is a defect. Start from `client/pages/reference/examples` (orders, team-settings, inbox, dashboard) for structure and from `client/pages/reference/components` for component APIs.

## 1. Page frame

- A top-level page is `PageContainer` + `PageHeader` (title = the menu name, one sentence of description, the primary action on the right). No `max-w-*` or `mx-auto` at page level: pages use the full width.
- Only form content and dialog content are width-limited: forms use `max-w-2xl` (`FieldGroup className='max-w-2xl'`), dialogs size their `DialogContent` / `RouteDialog`.
- Tabs of a page are child routes (`NpRouteTabs` + `useIsParentEntry` redirect to the default tab); tab content renders inside the parent's `PageContainer` and adds none of its own. A tab section starts with `ConfigSectionHeading`-style heading (title, one sentence, actions right).
- Every top-level page renders `NpShortcuts` once (see §7).

## 2. Lists

- Toolbar on the left (search, filters, view switch — `IssueToolbar` is the model), the primary button in the page header on the right.
- Lists are `DataTable` (default density). Server-paged lists pass `pagination={false}` and show "Load more" under the table (`np.pagination.*`); client-paged lists keep `pageSize={20}`.
- Loading: `NpListSkeleton` (or a skeleton shaped like the content). Empty: `NpEmpty` with an icon, a title, one sentence and the create action. Failed: `NpLoadError` (retry, none on 403).

## 3. Detail pages

- A record's page is a covering `RouteChildPage` in `NpDetailLayout`: main column `flex-1 min-w-0`, right column fixed `w-80` with its own scroll, folded into one column below `lg`.
- The main column starts with `Breadcrumbs` + `PageHeader` (the issue detail keeps its inline-editable title as the header). Blocks are `Card`s (title + actions top right) with the same spacing (`space-y-6`).
- Loading uses `NpDetailSkeleton`; a 404/403 uses `NpLoadError` with "back to the list".

## 4. Identifiers, badges, people

- Issue identifiers: `font-mono text-xs`. Slugs and versions: `font-mono text-xs`.
- Status: only `NpStatusBadge` (outline badge, dot colored from the status catalog / workflow color). Priority: `NpPriorityLabel`. Run status: `NpRunStatusBadge`.
- People, agents and the system: only `NpActorAvatar` (initials / bot / cog). `NpExecutor` builds on it and adds the "Agent" marker.

## 5. Feedback

- Every explicit write action (a button, a menu item, a form submit) shows a toast on success and on failure; failures are localized (`np.common.forbidden`, `np.common.requestFailed`, or a specific key for 409s).
- Inline property edits in the issue properties panel and emoji reactions change the value in place; they toast only on failure (a success toast per field change would drown the page).
- Destructive actions (delete, archive, revert, reject a label) go through `AlertDialog` with a `destructive` action.

## 6. Reference pages

Copy structure from `client/pages/reference/`, never import from it.

## 7. Keyboard

- `C` opens "New issue" (on `/issues` the create dialog beside the list), ignored while typing or when a dialog is open.
- `⌘K` / `Ctrl+K` opens the issue search (`GET /np/issues?q=`, title or identifier); Enter opens the highlighted issue.
- `⌘Enter` sends a comment in the composer, saves a knowledge document in its editor, and sends an inline inbox comment.

## 8. Long lists

- Cursor pages (`useInfiniteQuery`, §D): the issue list, board columns ("load more" per column), older issue activities, the inbox.
- Virtualization (`react-virtuoso`): the activity timeline and board columns past 100 items (`NpVirtualList`), the issue table past 200 rows (`DataTable virtualizeAfter`). The list measures against the nearest scrolling ancestor, so it works in covering pages and drawers.
- Query keys of pages sit under the family the realtime topics invalidate (`npKeys.issues`, `npKeys.issue(id)`), so a push refetches every loaded page.

## 9. Themes and languages

- Colors are tokens only (`bg-card`, `text-muted-foreground`, `bg-chart-N`); check both light and dark.
- Every string is a key in `client/locales/` with `en-US` and `zh-CN`; `tests/logic/locale-coverage.test.ts` fails on a missing key. New groups go in the latest `np-iterN-*.ts`; avoid i18next plural suffixes (the Chinese side must have the same keys).
