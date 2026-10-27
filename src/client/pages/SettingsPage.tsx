import { useEffect, useState } from 'react';
import { LuCheck, LuDownload, LuKeyRound, LuShieldCheck, LuTrash2 } from 'react-icons/lu';
import { api, ApiError } from '../lib/api';
import { useQuery, invalidate } from '../lib/query';
import { useAction } from '../lib/actions';
import { useAuth } from '../lib/auth';
import { formatDateTime } from '../lib/format';
import { RESEARCH_DEPTHS, RESEARCH_DEPTH_LABEL } from '../../shared/constants';
import { Badge, Button, Callout, Field, Input, PageHeader, Panel, Select, Skeleton } from '../components/ui/primitives';
import { Dialog, LinkTabs, useToast } from '../components/ui/overlays';
import { cn } from '../components/ui/cn';

type ProviderId = 'anthropic' | 'openai' | 'openai_compatible';

interface AiSettingsPayload {
  configured: boolean;
  provider: ProviderId;
  keySource: 'user' | 'environment' | null;
  models: Record<string, string>;
  webSearch: boolean;
  message: string | null;
  settings: { provider: ProviderId; models: Record<string, string>; compatibleBaseUrl: string; researchDepth: 'standard' | 'deep' | 'maximum'; researchLocation: string };
  keys: Record<ProviderId, string | null>;
  envKeys: { anthropic: boolean; openai: boolean };
  roles: Record<string, string>;
  suggestedModels: Record<ProviderId, string[]>;
  defaultModels: Record<ProviderId, Record<string, string>>;
}

const PROVIDERS: { id: ProviderId; name: string; detail: string }[] = [
  { id: 'anthropic', name: 'Anthropic (Claude)', detail: 'Recommended. Structured outputs and cited web search for company research.' },
  { id: 'openai', name: 'OpenAI', detail: 'Responses API with structured outputs and web search.' },
  { id: 'openai_compatible', name: 'OpenAI-compatible', detail: 'Gemini, OpenRouter, Ollama, LM Studio and others. No web research.' },
];

function AiSettings() {
  const { data, loading } = useQuery<AiSettingsPayload>('/api/settings/ai');
  const toast = useToast();
  const { run, busy } = useAction();
  const [form, setForm] = useState<AiSettingsPayload['settings'] | null>(null);
  const [key, setKey] = useState('');
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null);
  useEffect(() => {
    if (data) setForm(data.settings);
  }, [data]);
  if (loading || !data || !form) return <Skeleton className="h-96 w-full" />;
  const provider = form.provider;
  const refresh = ['/api/settings/ai', '/api/brain', '/api/dashboard'];
  const dirty = JSON.stringify(form) !== JSON.stringify(data.settings);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <Panel title="AI provider" description="Your documents and applications are sent to this provider to generate results, under its API terms. API providers do not train on API data by default; check their policy.">
        <div className="grid gap-2 sm:grid-cols-3">
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setForm({ ...form, provider: p.id })}
              aria-pressed={provider === p.id}
              className={cn('rounded-control border px-3.5 py-3 text-left', provider === p.id ? 'border-ink ring-1 ring-ink' : 'border-rule-strong hover:border-mist')}
            >
              <div className="flex items-center justify-between gap-2 text-sm font-medium text-ink">
                {p.name}
                {data.keys[p.id] && <LuKeyRound className="size-3.5 text-jade" />}
              </div>
              <div className="mt-0.5 text-[12.5px] leading-snug text-graphite">{p.detail}</div>
            </button>
          ))}
        </div>

        <div className="mt-6 flex flex-col gap-4">
          <Field
            label={provider === 'openai_compatible' ? 'API key (if your endpoint needs one)' : 'API key'}
            hint={
              data.keys[provider]
                ? `Saved: ${data.keys[provider]}. Stored encrypted; it is never shown again.`
                : provider !== 'openai_compatible' && data.envKeys[provider as 'anthropic' | 'openai']
                  ? 'Using the key from the server environment (.env). A key saved here takes precedence.'
                  : provider === 'anthropic'
                    ? 'Create one at console.anthropic.com. Starts with sk-ant-.'
                    : 'Stored encrypted on this server.'
            }
          >
            <div className="flex gap-2">
              <Input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={data.keys[provider] ? 'Replace the saved key' : 'Paste your key'} />
              <Button
                variant="primary"
                disabled={key.trim().length < 8}
                loading={busy === 'key'}
                onClick={async () => {
                  const r = await run('key', () => api.put('/api/settings/ai/key', { provider, key: key.trim() }), { refresh, success: 'Key saved.' });
                  if (r) setKey('');
                }}
              >
                Save key
              </Button>
              {data.keys[provider] && (
                <Button variant="ghost" onClick={() => void run('rm', () => api.delete(`/api/settings/ai/key/${provider}`), { refresh, success: 'Key removed.' })}>
                  Remove
                </Button>
              )}
            </div>
          </Field>
          {provider === 'openai_compatible' && (
            <Field label="Base URL" hint="For example https://generativelanguage.googleapis.com/v1beta/openai or http://localhost:11434/v1">
              <Input value={form.compatibleBaseUrl} onChange={(e) => setForm({ ...form, compatibleBaseUrl: e.target.value })} />
            </Field>
          )}
        </div>
      </Panel>

      <Panel title="Models" description="Different steps can use different models. Leave blank for the recommended default.">
        <div className="grid gap-4 sm:grid-cols-2">
          {Object.entries(data.roles).map(([role, label]) => (
            <Field key={role} label={label} hint={`Default: ${data.defaultModels[provider]?.[role] || 'none, set one'}`}>
              <Input
                list={`models-${provider}`}
                value={form.models[role] ?? ''}
                onChange={(e) => setForm({ ...form, models: { ...form.models, [role]: e.target.value } })}
                placeholder={data.defaultModels[provider]?.[role] ?? ''}
              />
            </Field>
          ))}
        </div>
        <datalist id={`models-${provider}`}>
          {data.suggestedModels[provider].map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </Panel>

      <Panel title="Research defaults">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Default depth">
            <Select value={form.researchDepth} onChange={(e) => setForm({ ...form, researchDepth: e.target.value as typeof form.researchDepth })}>
              {RESEARCH_DEPTHS.map((d) => (
                <option key={d} value={d}>
                  {RESEARCH_DEPTH_LABEL[d]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Search from location" optional hint="Localizes web results, e.g. Chicago, Illinois">
            <Input value={form.researchLocation} onChange={(e) => setForm({ ...form, researchLocation: e.target.value })} />
          </Field>
        </div>
      </Panel>

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" disabled={!dirty} loading={busy === 'save'} onClick={() => void run('save', () => api.put('/api/settings/ai', form), { refresh, success: 'Settings saved.' })}>
          Save settings
        </Button>
        <Button
          loading={busy === 'test'}
          disabled={dirty}
          onClick={async () => {
            setTest(null);
            const r = await run('test', () => api.post<{ ok: boolean; message: string }>('/api/settings/ai/test'));
            if (r) {
              setTest(r);
              if (r.ok) toast('Connection works.', 'success');
            }
          }}
        >
          Test connection
        </Button>
        {data.configured ? (
          <Badge tone="jade">
            <LuCheck className="size-3" /> Ready ({data.keySource === 'user' ? 'your key' : 'server key'})
          </Badge>
        ) : (
          <Badge tone="ochre">Not connected</Badge>
        )}
      </div>
      {test && <Callout tone={test.ok ? 'jade' : 'brick'}>{test.message}</Callout>}
    </div>
  );
}

function AccountSettings() {
  const { user } = useAuth();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex max-w-xl flex-col gap-6">
      <Panel title="Account">
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-graphite">Email</dt>
          <dd className="text-ink">{user?.email}</dd>
          <dt className="text-graphite">Plan</dt>
          <dd className="text-ink capitalize">{user?.plan}</dd>
        </dl>
      </Panel>
      <Panel title="Change password" description="Other signed-in devices are signed out.">
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setErr(null);
            try {
              await api.post('/api/auth/password', { currentPassword: current, newPassword: next });
              toast('Password changed.', 'success');
              setCurrent('');
              setNext('');
            } catch (error) {
              setErr(error as ApiError);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Current password">
            <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </Field>
          <Field label="New password" error={err?.fieldError('newPassword')} hint="At least 10 characters.">
            <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          </Field>
          {err && !err.fieldError('newPassword') && <Callout tone="brick">{err.message}</Callout>}
          <div>
            <Button type="submit" variant="primary" loading={busy} disabled={!current || !next}>
              Change password
            </Button>
          </div>
        </form>
      </Panel>
    </div>
  );
}

function PrivacySettings() {
  const { logout } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <Panel title="How your data is protected">
        <ul className="flex flex-col gap-2.5 text-sm text-ink-soft">
          {[
            'Uploaded documents and API keys are encrypted at rest (AES-256-GCM).',
            'Passwords are hashed with scrypt. Sessions use random tokens stored only as hashes.',
            'Every record belongs to your account; no other account can read it.',
            'Data is sent only to the AI provider you configure, to produce results you ask for.',
            'Sign-ins, uploads, exports, approvals and deletions are recorded in your activity log.',
          ].map((t) => (
            <li key={t} className="flex gap-2.5">
              <LuShieldCheck className="mt-0.5 size-4 shrink-0 text-jade" />
              {t}
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="Export your data" description="A ZIP with every record, AI output and version, plus your original documents.">
        <a href="/api/account/export" className="inline-flex h-9 items-center gap-2 rounded-control border border-rule-strong bg-surface px-3.5 text-sm font-medium text-ink hover:bg-paper">
          <LuDownload className="size-4" /> Download export
        </a>
      </Panel>
      <Panel title="Delete account" description="Permanently deletes your account, documents, Career Brain, applications and history. This cannot be undone.">
        <Button variant="danger" icon={<LuTrash2 className="size-4" />} onClick={() => setOpen(true)}>
          Delete account
        </Button>
      </Panel>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Delete your account?"
        description="Export first if you want a copy."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={busy}
              disabled={confirm !== 'DELETE' || !password}
              onClick={async () => {
                setBusy(true);
                try {
                  await api.post('/api/account/delete', { password, confirm });
                  toast('Account deleted.', 'success');
                  await logout().catch(() => undefined);
                } catch (err) {
                  toast((err as ApiError).message, 'error');
                } finally {
                  setBusy(false);
                }
              }}
            >
              Delete everything
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Password">
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Field label='Type "DELETE" to confirm'>
            <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
        </div>
      </Dialog>
    </div>
  );
}

function UsageSettings() {
  const { data, loading } = useQuery<{ totals: Record<string, number>; recent: Record<string, any>[] }>('/api/settings/usage');
  if (loading || !data) return <Skeleton className="h-64 w-full" />;
  const t = data.totals;
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 divide-x divide-rule rounded-panel border border-rule bg-surface sm:grid-cols-4">
        {[
          [t.calls, 'AI calls (30 days)'],
          [`$${Number(t.cost).toFixed(2)}`, 'Estimated cost'],
          [Number(t.input + t.output).toLocaleString(), 'Tokens'],
          [t.searches, 'Web searches'],
        ].map(([v, l]) => (
          <div key={String(l)} className="px-5 py-4">
            <div className="font-display text-2xl font-semibold text-ink">{v}</div>
            <div className="mt-1 text-[13px] text-graphite">{l}</div>
          </div>
        ))}
      </div>
      <p className="text-[12.5px] text-mist">Costs are estimates from list prices for known models. Your provider’s billing is authoritative.</p>
      <div className="overflow-x-auto rounded-panel border border-rule bg-surface">
        <table className="w-full min-w-[640px] text-left text-[13px]">
          <thead className="border-b border-rule bg-paper/60 text-graphite">
            <tr>
              <th className="px-5 py-2.5 font-medium">What</th>
              <th className="px-3 py-2.5 font-medium">Model</th>
              <th className="px-3 py-2.5 font-medium">Tokens</th>
              <th className="px-3 py-2.5 font-medium">Cost</th>
              <th className="px-3 py-2.5 font-medium">When</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-rule">
            {data.recent.map((r, i) => (
              <tr key={i}>
                <td className="px-5 py-2.5 text-ink">
                  {r.purpose}
                  {r.status === 'error' && <span className="ml-2 text-brick">failed</span>}
                </td>
                <td className="px-3 py-2.5 text-graphite">{r.model}</td>
                <td className="px-3 py-2.5 text-graphite tabular">{(r.input_tokens + r.output_tokens).toLocaleString()}</td>
                <td className="px-3 py-2.5 text-graphite tabular">{r.cost_usd ? `$${Number(r.cost_usd).toFixed(3)}` : '–'}</td>
                <td className="px-3 py-2.5 text-graphite">{formatDateTime(r.created_at)}</td>
              </tr>
            ))}
            {!data.recent.length && (
              <tr>
                <td colSpan={5} className="px-5 py-6 text-center text-mist">
                  No AI calls yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const ACTION_LABEL: Record<string, string> = {
  'auth.signup': 'Account created',
  'auth.login': 'Signed in',
  'auth.login_failed': 'Failed sign-in attempt',
  'auth.logout': 'Signed out',
  'auth.password_changed': 'Password changed',
  'document.uploaded': 'Document uploaded',
  'document.deleted': 'Document deleted',
  'document.downloaded': 'Document downloaded',
  'brain.built': 'Career Brain updated from documents',
  'brain.item_changed': 'Career Brain edited',
  'settings.updated': 'Settings changed',
  'settings.api_key_set': 'API key saved',
  'settings.api_key_removed': 'API key removed',
  'application.created': 'Application created',
  'application.deleted': 'Application deleted',
  'application.stage_changed': 'Application stage changed',
  'artifact.approved': 'Document approved',
  'artifact.exported': 'Document downloaded',
  'account.exported': 'Data exported',
};

function ActivitySettings() {
  const { data, loading } = useQuery<{ entries: { action: string; meta: Record<string, unknown>; ip: string | null; created_at: string }[] }>('/api/settings/audit');
  if (loading || !data) return <Skeleton className="h-64 w-full" />;
  return (
    <div className="overflow-hidden rounded-panel border border-rule bg-surface">
      <ul className="divide-y divide-rule">
        {data.entries.map((e, i) => (
          <li key={i} className="flex items-center justify-between gap-4 px-5 py-2.5 text-[13px]">
            <span className={cn('text-ink', e.action === 'auth.login_failed' && 'text-brick')}>{ACTION_LABEL[e.action] ?? e.action}</span>
            <span className="shrink-0 text-graphite">
              {formatDateTime(e.created_at)}
              {e.ip ? ` from ${e.ip}` : ''}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SettingsPage({ tab }: { tab: string }) {
  useEffect(() => invalidate('/api/settings/ai'), []);
  const tabs = [
    { key: 'ai', label: 'AI provider', href: '/settings' },
    { key: 'account', label: 'Account', href: '/settings/account' },
    { key: 'privacy', label: 'Privacy & data', href: '/settings/privacy' },
    { key: 'usage', label: 'Usage', href: '/settings/usage' },
    { key: 'activity', label: 'Activity log', href: '/settings/activity' },
  ];
  return (
    <div>
      <PageHeader title="Settings" />
      <LinkTabs tabs={tabs} active={tab} />
      <div className="pt-6">
        {tab === 'account' ? <AccountSettings /> : tab === 'privacy' ? <PrivacySettings /> : tab === 'usage' ? <UsageSettings /> : tab === 'activity' ? <ActivitySettings /> : <AiSettings />}
      </div>
    </div>
  );
}
