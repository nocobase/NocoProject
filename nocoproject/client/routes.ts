import { Bot, Home, ListTodo, MonitorCog } from 'lucide-react';
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
        ],
      },
    ],
  },
  {
    auth: 'required',
    authz: { resource: { type: 'page', id: 'np-agents' }, action: 'access' },
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

const settingsRoutes: AppClientRouteContribution = defineSettingsRoutes([]);

const routes: readonly AppClientRouteContribution[] = [
  appRoutes,
  settingsRoutes,
];

export default routes;
