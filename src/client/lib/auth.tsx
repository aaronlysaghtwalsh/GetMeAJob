import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, onUnauthorized } from './api';
import { clearQueryCache } from './query';
import { navigate } from './router';

export interface User {
  id: string;
  email: string;
  displayName: string;
  plan: string;
}

interface AuthState {
  ready: boolean;
  user: User | null;
  signupAllowed: boolean;
  hasUsers: boolean;
}

interface AuthApi extends AuthState {
  login(email: string, password: string): Promise<void>;
  signup(email: string, password: string, displayName: string): Promise<void>;
  logout(): Promise<void>;
  reload(): Promise<void>;
}

const AuthContext = createContext<AuthApi | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ ready: false, user: null, signupAllowed: false, hasUsers: true });

  const reload = useCallback(async () => {
    try {
      const s = await api.get<{ user: User | null; signupAllowed: boolean; hasUsers: boolean }>('/api/auth/state');
      setState({ ready: true, ...s });
    } catch {
      setState((prev) => ({ ...prev, ready: true }));
    }
  }, []);

  useEffect(() => {
    void reload();
    return onUnauthorized(() => {
      clearQueryCache();
      setState((prev) => ({ ...prev, user: null }));
    });
  }, [reload]);

  const value = useMemo<AuthApi>(
    () => ({
      ...state,
      reload,
      async login(email, password) {
        const r = await api.post<{ user: User }>('/api/auth/login', { email, password });
        clearQueryCache();
        setState((prev) => ({ ...prev, user: r.user }));
      },
      async signup(email, password, displayName) {
        const r = await api.post<{ user: User }>('/api/auth/signup', { email, password, displayName });
        clearQueryCache();
        setState((prev) => ({ ...prev, user: r.user, hasUsers: true, signupAllowed: false }));
      },
      async logout() {
        await api.post('/api/auth/logout');
        clearQueryCache();
        setState((prev) => ({ ...prev, user: null }));
        navigate('/login');
      },
    }),
    [state, reload],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthApi {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
