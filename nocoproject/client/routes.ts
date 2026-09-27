import {
  BarChart3,
  Bot,
  FolderKanban,
  GitPullRequest,
  Home,
  ListPlus,
  ListTodo,
  MonitorCog,
  Settings2,
  Sparkles,
  UsersRound,
} from 'lucide-react';
import {
  defineAppRoutes,
  defineSettingsRoutes,
  type AppClientRouteContribution,
} from '@nocobase/app-client/plugins';

import { NpInboxNavIcon } from './components/np-inbox-nav-icon.js';

const appRoutes: AppClientRouteContribution = defineAppRoutes([
  {
    // Every signed-in user reaches the landing page. `authz: 'skip'` takes it out of page authorization entirely, so
    // no permission change can leave a user signed in with nowhere to land.
    authz: 'skip',
    auth: 'required',
    componentLoader: () => import('./pages/home.js'),
    name: 'home',
    navigation: { title: 'navigation.home', icon: Home },
    path: '/',
  },
  {
    // NocoProject inbox (iteration 1 §J 3): decisions and notifications for the signed-in user. The icon carries the
    // unread decision count (iteration 2 §K). `approvals` (iteration 2 §D) is a covering child page that inherits the
    // `np-inbox` grant.
    auth: 'required',
    authz: { resource: { type: 'page', id: 'np-inbox' }, action: 'access' },
    breadcrumb: { title: 'navigation.inbox' },
    componentLoader: () => import('./pages/np/inbox/index.js'),
    name: 'np-inbox',
    navigation: { title: 'navigation.inbox', icon: NpInboxNavIcon },
    path: '/inbox',
    children: [
      {
        breadcrumb: { title: 'np.approvals.pageTitle' },
        componentLoader: () => import('./pages/np/inbox/approvals.js'),
        name: 'np-approvals',
        path: 'approvals',
      },
    ],
  },
  {
    // NocoProject issues. The detail is a covering child page (the list keeps its filters underneath); create and the
    // run transcript are route dialogs. Children omit `authz` and inherit the `np-issues` page grant.
    auth: 'required',
    authz: { resource: { type: 'page', id: 'np-issues' }, action: 'access' },
    breadcrumb: { title: 'navigation.issues' },
    componentLoader: () => import('./pages/np/issues/index.js'),
    name: 'np-issues',
    navigation: { title: 'navigation.issues', icon: ListTodo },
    path: '/issues',
    children: [
      {
        componentLoader: () => import('./pages/np/issues/new.js'),
        name: 'np-issue-new',
        path: 'new',
      },
      {
        breadcrumb: { title: 'np.issue.breadcrumb' },
        componentLoader: () => import('./pages/np/issues/detail/index.js'),
        name: 'np-issue-detail',
        path: ':issueId',
        children: [
          {
            componentLoader: () =>
              import('./pages/np/issues/detail/transcript.js'),
            name: 'np-run-transcript',
            path: 'runs/:runId',
          },
          {
            componentLoader: () =>
              import('./pages/np/issues/detail/new-subtask.js'),
            name: 'np-subtask-new',
            path: 'new-subtask',
          },
        ],
      },
    ],
  },
  {
    // Batch entry (iteration 2 §E, "批量录入"): paste text, review the parsed drafts, create the issues.
    auth: 'required',
    authz: { resource: { type: 'page', id: 'np-intake' }, action: 'access' },
    componentLoader: () => import('./pages/np/intake/index.js'),
    name: 'np-intake',
    navigation: { title: 'navigation.intake', icon: ListPlus },
    path: '/intake',
  },
  {
    // NocoProject projects (iteration 1 §J 4). The detail is a covering child page; create and "add repository" are
    // route dialogs. Children inherit the `np-projects` page grant.
    auth: 'required',
    authz: { resource: { type: 'page', id: 'np-projects' }, action: 'access' },
    breadcrumb: { title: 'navigation.projects' },
    componentLoader: () => import('./pages/np/projects/index.js'),
    name: 'np-projects',
    navigation: { title: 'navigation.projects', icon: FolderKanban },
    path: '/projects',
    children: [
      {
        componentLoader: () => import('./pages/np/projects/new.js'),
        name: 'np-project-new',
        path: 'new',
      },
      {
        breadcrumb: { title: 'np.projects.breadcrumb' },
        componentLoader: () => import('./pages/np/projects/detail/index.js'),
        name: 'np-project-detail',
        path: ':projectId',
        children: [
          {
            componentLoader: () =>
              import('./pages/np/projects/detail/new-resource.js'),
            name: 'np-project-resource-new',
            path: 'resources/new',
          },
        ],
      },
    ],
  },
  {
    auth: 'required',
    authz: { resource: { type: 'page', id: 'np-agents' }, action: 'access' },
    breadcrumb: { title: 'navigation.agents' },
    componentLoader: () => import('./pages/np/agents/index.js'),
    name: 'np-agents',
    navigation: { title: 'navigation.agents', icon: Bot },
    path: '/agents',
    children: [
      {
        componentLoader: () => import('./pages/np/agents/new.js'),
        name: 'np-agent-new',
        path: 'new',
      },
      {
        // Iteration 1 §J 5: the agent's settings as a covering child page.
        breadcrumb: { title: 'np.agentDetail.breadcrumb' },
        componentLoader: () => import('./pages/np/agents/detail/index.js'),
        name: 'np-agent-detail',
        path: ':agentId',
      },
    ],
  },
  {
    // Skills (iteration 2 §H, "技能"): SKILL.md with files, mounted on agents. Create is a route dialog, the skill a
    // covering child page; both inherit the `np-skills` grant.
    auth: 'required',
    authz: { resource: { type: 'page', id: 'np-skills' }, action: 'access' },
    breadcrumb: { title: 'navigation.skills' },
    componentLoader: () => import('./pages/np/skills/index.js'),
    name: 'np-skills',
    navigation: { title: 'navigation.skills', icon: Sparkles },
    path: '/skills',
    children: [
      {
        componentLoader: () => import('./pages/np/skills/new.js'),
        name: 'np-skill-new',
        path: 'new',
      },
      {
        breadcrumb: { title: 'np.skills.breadcrumb' },
        componentLoader: () => import('./pages/np/skills/detail/index.js'),
        name: 'np-skill-detail',
        path: ':skillId',
      },
    ],
  },
  {
    auth: 'required',
    authz: { resource: { type: 'page', id: 'np-runtimes' }, action: 'access' },
    componentLoader: () => import('./pages/np/runtimes/index.js'),
    name: 'np-runtimes',
    navigation: { title: 'navigation.runtimes', icon: MonitorCog },
    path: '/runtimes',
    children: [
      {
        componentLoader: () => import('./pages/np/runtimes/connect.js'),
        name: 'np-runtime-connect',
        path: 'connect',
      },
    ],
  },
  {
    // Usage (iteration 2 §I, "用量统计"): tokens and estimated cost of runs, grouped five ways.
    auth: 'required',
    authz: { resource: { type: 'page', id: 'np-usage' }, action: 'access' },
    componentLoader: () => import('./pages/np/usage/index.js'),
    name: 'np-usage',
    navigation: { title: 'navigation.usage', icon: BarChart3 },
    path: '/usage',
  },
  {
    auth: 'guest',
    authz: 'skip',
    componentLoader: () => import('./pages/auth/login.js'),
    name: 'login',
    path: '/login',
  },
  {
    auth: 'guest',
    authz: 'skip',
    componentLoader: () => import('./pages/auth/register.js'),
    name: 'register',
    path: '/register',
  },
  {
    auth: 'guest',
    authz: 'skip',
    componentLoader: () => import('./pages/auth/forgot-password.js'),
    name: 'forgot-password',
    path: '/forgot-password',
  },
  {
    auth: 'guest',
    authz: 'skip',
    componentLoader: () => import('./pages/auth/reset-password.js'),
    name: 'reset-password',
    path: '/reset-password',
  },
]);

const settingsRoutes: AppClientRouteContribution = defineSettingsRoutes([
  {
    // Iteration 1 §J 6 / §B: the settings resource `np-members`. The server grants it to every member so the list is
    // readable; `PATCH /np/members/:userId` then refuses role changes by `members.role`, and the page disables the
    // role selects the same way.
    authz: {
      resource: { type: 'settings', id: 'np-members' },
      action: 'access',
    },
    componentLoader: () => import('./pages/np/settings/members.js'),
    name: 'np-members',
    navigation: { title: 'navigation.members', icon: UsersRound },
    path: '/members',
  },
  {
    // Iteration 2 §C: the GitHub connection. Owner/admin only by server rule (`/np/integrations/github` answers 403
    // otherwise); the settings item is registered so it can be granted like `np-members`.
    authz: {
      resource: { type: 'settings', id: 'np-github' },
      action: 'access',
    },
    componentLoader: () => import('./pages/np/settings/github.js'),
    name: 'np-github',
    navigation: { title: 'navigation.github', icon: GitPullRequest },
    path: '/github',
  },
  {
    // Iteration 2 §I: workspace settings (merged-PR status, sub-issue default, intake parser, model prices).
    // Owner/admin only by server rule (`PATCH /np/settings`).
    authz: {
      resource: { type: 'settings', id: 'np-settings' },
      action: 'access',
    },
    componentLoader: () => import('./pages/np/settings/nocoproject.js'),
    name: 'np-settings',
    navigation: { title: 'navigation.nocoproject', icon: Settings2 },
    path: '/nocoproject',
  },
]);

const routes: readonly AppClientRouteContribution[] = [
  appRoutes,
  settingsRoutes,
];

export default routes;
