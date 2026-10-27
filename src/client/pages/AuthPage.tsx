import { useState, type FormEvent } from 'react';
import { LuShieldCheck } from 'react-icons/lu';
import { ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Link, navigate } from '../lib/router';
import { Button, Callout, Field, Input } from '../components/ui/primitives';
import { Wordmark } from '../components/layout/AppShell';

export function AuthPage({ mode }: { mode: 'login' | 'signup' }) {
  const auth = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const firstUser = mode === 'signup' && !auth.hasUsers;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') await auth.login(email, password);
      else await auth.signup(email, password, name);
      navigate(mode === 'signup' ? '/brain' : '/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, 'error', 'Something went wrong.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-[400px]">
        <div className="mb-8 flex justify-center">
          <Wordmark />
        </div>
        <div className="rounded-panel border border-rule bg-surface px-7 py-7 shadow-[0_1px_2px_rgba(24,33,47,0.04)]">
          <h1 className="font-display text-2xl font-semibold text-ink">{mode === 'login' ? 'Sign in' : firstUser ? 'Set up GetMeAJob' : 'Create your account'}</h1>
          <p className="mt-1.5 text-sm leading-relaxed text-graphite">
            {mode === 'login'
              ? 'Pick up where you left off.'
              : firstUser
                ? 'This account will own everything stored on this server: your documents, Career Brain and applications.'
                : 'Your data stays private to your account.'}
          </p>
          <form onSubmit={submit} className="mt-6 flex flex-col gap-4" noValidate>
            {mode === 'signup' && (
              <Field label="Your name" htmlFor="name">
                <Input id="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
              </Field>
            )}
            <Field label="Email" htmlFor="email" error={error?.fieldError('email')}>
              <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus={mode === 'login'} />
            </Field>
            <Field
              label="Password"
              htmlFor="password"
              error={error?.fieldError('password')}
              hint={mode === 'signup' ? 'At least 10 characters. A short phrase works well.' : undefined}
            >
              <Input
                id="password"
                type="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            {error && !error.fieldError('email') && !error.fieldError('password') && <Callout tone="brick">{error.message}</Callout>}
            <Button type="submit" variant="primary" size="lg" loading={busy} className="mt-1 w-full">
              {mode === 'login' ? 'Sign in' : 'Create account'}
            </Button>
          </form>
        </div>
        <div className="mt-5 text-center text-sm text-graphite">
          {mode === 'login' ? (
            auth.signupAllowed ? (
              <>
                New here?{' '}
                <Link to="/signup" className="font-medium text-cobalt hover:underline">
                  Create an account
                </Link>
              </>
            ) : null
          ) : (
            <>
              Already have an account?{' '}
              <Link to="/login" className="font-medium text-cobalt hover:underline">
                Sign in
              </Link>
            </>
          )}
        </div>
        <p className="mt-8 flex items-center justify-center gap-1.5 text-[12px] text-mist">
          <LuShieldCheck className="size-3.5" />
          Documents and API keys are encrypted at rest.
        </p>
      </div>
    </div>
  );
}
