import type { Handler } from './core';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RouteOptions {
  /** Require a signed-in user (default true). */
  auth?: boolean;
}

interface Route {
  method: Method;
  segments: string[];
  handler: Handler;
  options: Required<RouteOptions>;
}

export type MatchResult =
  | { kind: 'match'; handler: Handler; params: Record<string, string>; options: Required<RouteOptions> }
  | { kind: 'method_not_allowed'; allowed: string[] }
  | { kind: 'none' };

/** A small path router: static segments, :params and a trailing * wildcard. */
export class Router {
  private routes: Route[] = [];

  add(method: Method, path: string, handler: Handler, options: RouteOptions = {}): this {
    this.routes.push({
      method,
      segments: path.split('/').filter(Boolean),
      handler,
      options: { auth: options.auth ?? true },
    });
    return this;
  }

  get(path: string, handler: Handler, options?: RouteOptions) {
    return this.add('GET', path, handler, options);
  }
  post(path: string, handler: Handler, options?: RouteOptions) {
    return this.add('POST', path, handler, options);
  }
  put(path: string, handler: Handler, options?: RouteOptions) {
    return this.add('PUT', path, handler, options);
  }
  patch(path: string, handler: Handler, options?: RouteOptions) {
    return this.add('PATCH', path, handler, options);
  }
  delete(path: string, handler: Handler, options?: RouteOptions) {
    return this.add('DELETE', path, handler, options);
  }

  match(method: string, pathname: string): MatchResult {
    const parts = pathname.split('/').filter(Boolean).map((p) => {
      try {
        return decodeURIComponent(p);
      } catch {
        return p;
      }
    });
    const allowed: string[] = [];
    for (const route of this.routes) {
      const params = matchSegments(route.segments, parts);
      if (!params) continue;
      if (route.method === method || (method === 'HEAD' && route.method === 'GET')) {
        return { kind: 'match', handler: route.handler, params, options: route.options };
      }
      allowed.push(route.method);
    }
    return allowed.length ? { kind: 'method_not_allowed', allowed } : { kind: 'none' };
  }
}

function matchSegments(pattern: string[], parts: string[]): Record<string, string> | null {
  const params: Record<string, string> = {};
  for (let i = 0; i < pattern.length; i++) {
    const seg = pattern[i];
    if (seg === '*') {
      params['*'] = parts.slice(i).join('/');
      return params;
    }
    const part = parts[i];
    if (part === undefined) return null;
    if (seg.startsWith(':')) params[seg.slice(1)] = part;
    else if (seg !== part) return null;
  }
  return parts.length === pattern.length ? params : null;
}
