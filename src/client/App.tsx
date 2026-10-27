import { useEffect, useMemo } from 'react';
import { AuthProvider, useAuth } from './lib/auth';
import { navigate, RouterProvider, useLocation, useRoutes } from './lib/router';
import { ToastProvider } from './components/ui/overlays';
import { Spinner } from './components/ui/primitives';
import { AppShell } from './components/layout/AppShell';
import { AuthPage } from './pages/AuthPage';
import { DashboardPage } from './pages/DashboardPage';
import { BrainPage } from './pages/brain/BrainPage';
import { ApplicationsPage } from './pages/applications/ApplicationsPage';
import { NewApplicationPage } from './pages/applications/NewApplicationPage';
import { WorkspacePage } from './pages/applications/WorkspacePage';
import { SettingsPage } from './pages/SettingsPage';
import { RoadmapPage } from './pages/RoadmapPage';
import { NotFoundPage } from './pages/NotFoundPage';

function AuthedRoutes() {
  const routes = useMemo(
    () => [
      { path: '/', render: () => <DashboardPage /> },
      { path: '/brain/:tab?', render: (p: Record<string, string>) => <BrainPage tab={p.tab ?? 'overview'} /> },
      { path: '/applications', render: () => <ApplicationsPage /> },
      { path: '/applications/new', render: () => <NewApplicationPage /> },
      { path: '/applications/:id/:tab?', render: (p: Record<string, string>) => <WorkspacePage id={p.id} tab={p.tab ?? 'overview'} /> },
      { path: '/settings/:tab?', render: (p: Record<string, string>) => <SettingsPage tab={p.tab ?? 'ai'} /> },
      { path: '/roadmap', render: () => <RoadmapPage /> },
    ],
    [],
  );
  return <>{useRoutes(routes, <NotFoundPage />)}</>;
}

function Root() {
  const auth = useAuth();
  const { path } = useLocation();

  useEffect(() => {
    if (auth.user && (path === '/login' || path === '/signup')) navigate('/', { replace: true });
  }, [auth.user, path]);

  if (!auth.ready) {
    return (
      <div className="flex min-h-screen items-center justify-center text-graphite">
        <Spinner className="size-5" />
      </div>
    );
  }
  if (!auth.user) {
    const signup = path === '/signup' ? auth.signupAllowed : !auth.hasUsers;
    return <AuthPage mode={signup ? 'signup' : 'login'} />;
  }
  return (
    <AppShell>
      <AuthedRoutes />
    </AppShell>
  );
}

export function App() {
  return (
    <RouterProvider>
      <AuthProvider>
        <ToastProvider>
          <Root />
        </ToastProvider>
      </AuthProvider>
    </RouterProvider>
  );
}
