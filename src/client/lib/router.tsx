import { createContext, useContext, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react';

interface Location {
  path: string;
  search: URLSearchParams;
}

const RouterContext = createContext<Location>({ path: '/', search: new URLSearchParams() });

const listeners = new Set<() => void>();
const guards = new Set<() => string | null>();

/** Register a "you have unsaved changes" guard; returns an unregister function. */
export function addNavigationGuard(fn: () => string | null): () => void {
  guards.add(fn);
  return () => guards.delete(fn);
}

function current(): Location {
  return { path: window.location.pathname, search: new URLSearchParams(window.location.search) };
}

export function navigate(to: string, opts: { replace?: boolean } = {}): void {
  for (const g of guards) {
    const msg = g();
    if (msg && !window.confirm(msg)) return;
  }
  if (opts.replace) window.history.replaceState(null, '', to);
  else window.history.pushState(null, '', to);
  listeners.forEach((l) => l());
  if (!to.includes('#')) window.scrollTo({ top: 0 });
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const [loc, setLoc] = useState<Location>(current);
  useEffect(() => {
    const update = () => setLoc(current());
    listeners.add(update);
    window.addEventListener('popstate', update);
    return () => {
      listeners.delete(update);
      window.removeEventListener('popstate', update);
    };
  }, []);
  return <RouterContext.Provider value={loc}>{children}</RouterContext.Provider>;
}

export function useLocation(): Location {
  return useContext(RouterContext);
}

/** Match a pattern like /applications/:id/:tab? against a path. */
export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const pp = pattern.split('/').filter(Boolean);
  const parts = path.split('/').filter(Boolean);
  const params: Record<string, string> = {};
  for (let i = 0; i < pp.length; i++) {
    const seg = pp[i];
    const optional = seg.endsWith('?');
    const name = optional ? seg.slice(0, -1) : seg;
    const part = parts[i];
    if (part === undefined) {
      if (optional) continue;
      return null;
    }
    if (name.startsWith(':')) params[name.slice(1)] = decodeURIComponent(part);
    else if (name !== part) return null;
  }
  if (parts.length > pp.length) return null;
  return params;
}

export function useRoutes(routes: { path: string; render: (params: Record<string, string>) => ReactNode }[], fallback: ReactNode): ReactNode {
  const { path } = useLocation();
  return useMemo(() => {
    for (const r of routes) {
      const params = matchPath(r.path, path);
      if (params) return r.render(params);
    }
    return fallback;
  }, [path, routes, fallback]);
}

export function Link({
  to,
  children,
  className,
  replace,
  ...rest
}: { to: string; children: ReactNode; className?: string; replace?: boolean } & Record<string, unknown>) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to, { replace });
  };
  return (
    <a href={to} onClick={onClick} className={className} {...rest}>
      {children}
    </a>
  );
}
