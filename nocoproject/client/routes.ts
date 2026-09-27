import {
  Bot,
  FolderKanban,
  Home,
  Inbox,
  ListTodo,
  MonitorCog,
  UsersRound,
} from 'lucide-react';
import {
  defineAppRoutes,
  defineSettingsRoutes,
  type AppClientRouteContribution,
} from '@nocobase/app-client/plugins';

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
    // NocoProject inbox (iteration 1 §J 3): decisions and notifications for the signed-in user.
    auth: 'required',
    authz: { resource: { type: 'page', id: 'np-inbox' }, action: 'access' },
    componentLoader: () => import('./pages/np/inbox/index.js'),
    name: 'np-inbox',
    navigation: { title: 'navigation.inbox', icon: Inbox },
    path: '/inbox',
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
]);

const routes: readonly AppClientRouteContribution[] = [
  appRoutes,
  settingsRoutes,
];

export default routes;
