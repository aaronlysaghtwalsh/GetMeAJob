import { useState, type FormEvent } from 'react';
import { LuClipboardPaste, LuLink } from 'react-icons/lu';
import { api, ApiError } from '../../lib/api';
import { useQuery, invalidate } from '../../lib/query';
import { Link, navigate } from '../../lib/router';
import type { AiStatus, Readiness } from '../../lib/types';
import { RESEARCH_DEPTHS, RESEARCH_DEPTH_HELP, RESEARCH_DEPTH_LABEL, type ResearchDepth } from '../../../shared/constants';
import { Button, Callout, Field, Input, PageHeader, Textarea } from '../../components/ui/primitives';
import { SegmentedControl } from '../../components/ui/overlays';
import { cn } from '../../components/ui/cn';

export function NewApplicationPage() {
  const ai = useQuery<AiStatus>('/api/settings/ai');
  const readiness = useQuery<Readiness>('/api/brain/readiness');
  const [mode, setMode] = useState<'paste' | 'url'>('paste');
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [companyWebsite, setCompanyWebsite] = useState('');
  const [questions, setQuestions] = useState('');
  const [depth, setDepth] = useState<ResearchDepth>('deep');
  const [buildMode, setBuildMode] = useState<'full' | 'fit_first'>('full');
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ applicationId: string }>('/api/applications', { mode, text, url, companyName, companyWebsite, questions, researchDepth: depth, buildMode });
      invalidate('/api/applications');
      invalidate('/api/dashboard');
      navigate(`/applications/${r.applicationId}`);
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  };

  const notReady = readiness.data && !readiness.data.ready;
  return (
    <div className="max-w-3xl">
      <PageHeader title="New application" description="Give GetMeAJob the job. It will research the company, judge your fit honestly, decide how to position you, then write the application from that strategy." />
      {ai.data && !ai.data.configured && (
        <Callout tone="ochre" className="mb-5" title="Connect an AI provider first" action={<Link to="/settings" className="text-sm font-medium text-cobalt hover:underline">Settings</Link>}>
          {ai.data.message}
        </Callout>
      )}
      {notReady && (
        <Callout tone="cobalt" className="mb-5" title="Your Career Brain is not complete yet" action={<Link to="/brain" className="text-sm font-medium text-cobalt hover:underline">Finish setup</Link>}>
          {readiness.data!.headline} You can still continue; results improve as your Career Brain fills in.
        </Callout>
      )}
      <form onSubmit={submit} className="flex flex-col gap-6">
        <section className="rounded-panel border border-rule bg-surface px-6 py-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-[15px] font-semibold text-ink">The job</h2>
            <SegmentedControl
              value={mode}
              onChange={setMode}
              options={[
                { value: 'paste', label: <><LuClipboardPaste /> Paste description</> },
                { value: 'url', label: <><LuLink /> Import from link</> },
              ]}
            />
          </div>
          {mode === 'paste' ? (
            <div className="mt-4 flex flex-col gap-4">
              <Field label="Job description" error={error?.fieldError('text')} hint="Paste the whole posting, including requirements, pay and anything about sponsorship.">
                <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={12} placeholder="Customer Insights Analyst&#10;Northwind Analytics, Chicago, IL…" />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Company" optional hint="Detected automatically if left empty.">
                  <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
                </Field>
                <Field label="Company website" optional hint="Helps research find the right company.">
                  <Input value={companyWebsite} onChange={(e) => setCompanyWebsite(e.target.value)} placeholder="https://" />
                </Field>
              </div>
              <Field label="Link to the posting" optional>
                <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
              </Field>
            </div>
          ) : (
            <div className="mt-4 flex flex-col gap-4">
              <Field
                label="Job posting link"
                error={error?.fieldError('url')}
                hint="Works with Greenhouse, Lever, Ashby and SmartRecruiters (including their application questions) and most company career pages. LinkedIn, Indeed and Glassdoor do not allow automated access: paste those instead."
              >
                <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://boards.greenhouse.io/company/jobs/123456" autoFocus />
              </Field>
              <Field label="Company website" optional>
                <Input value={companyWebsite} onChange={(e) => setCompanyWebsite(e.target.value)} placeholder="https://" />
              </Field>
            </div>
          )}
        </section>

        <section className="rounded-panel border border-rule bg-surface px-6 py-5">
          <h2 className="text-[15px] font-semibold text-ink">Application questions</h2>
          <p className="mt-1 text-[13px] text-graphite">Optional. Paste the questions from the application form, one per line. Limits like "(250 words)" are detected. You can add more later.</p>
          <Textarea className="mt-3" value={questions} onChange={(e) => setQuestions(e.target.value)} rows={5} placeholder={'1. Why are you interested in this role? (150 words)\n2. Will you now or in the future require sponsorship?'} />
        </section>

        <section className="rounded-panel border border-rule bg-surface px-6 py-5">
          <h2 className="text-[15px] font-semibold text-ink">Research depth</h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {RESEARCH_DEPTHS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDepth(d)}
                aria-pressed={depth === d}
                className={cn('rounded-control border px-3.5 py-3 text-left transition-colors', depth === d ? 'border-ink bg-ink/[0.03] ring-1 ring-ink' : 'border-rule-strong hover:border-mist')}
              >
                <div className="text-sm font-medium text-ink">{RESEARCH_DEPTH_LABEL[d]}</div>
                <div className="mt-0.5 text-[12.5px] leading-snug text-graphite">{RESEARCH_DEPTH_HELP[d]}</div>
              </button>
            ))}
          </div>
          <p className="mt-3 text-[12.5px] text-mist">Use Maximum for roles you really want. Deeper research costs more web searches.</p>
        </section>

        <section className="rounded-panel border border-rule bg-surface px-6 py-5">
          <h2 className="text-[15px] font-semibold text-ink">What to do</h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {(
              [
                ['full', 'Build the full application', 'Research, fit, strategy, tailored resume, cover letter, answers and a readiness review. Stops early if the fit analysis says not to apply.'],
                ['fit_first', 'Check fit first', 'Research, fit analysis and strategy only. Decide before spending time and money on documents.'],
              ] as const
            ).map(([value, title, desc]) => (
              <button
                key={value}
                type="button"
                onClick={() => setBuildMode(value)}
                aria-pressed={buildMode === value}
                className={cn('rounded-control border px-3.5 py-3 text-left transition-colors', buildMode === value ? 'border-ink bg-ink/[0.03] ring-1 ring-ink' : 'border-rule-strong hover:border-mist')}
              >
                <div className="text-sm font-medium text-ink">{title}</div>
                <div className="mt-0.5 text-[12.5px] leading-snug text-graphite">{desc}</div>
              </button>
            ))}
          </div>
        </section>

        {error && !error.fieldError('text') && !error.fieldError('url') && <Callout tone="brick">{error.message}</Callout>}
        <div className="flex items-center gap-3">
          <Button type="submit" variant="primary" size="lg" loading={busy} disabled={ai.data ? !ai.data.configured : false}>
            {buildMode === 'full' ? 'Build application' : 'Analyze fit'}
          </Button>
          <span className="text-[13px] text-graphite">Nothing is ever submitted to an employer without you.</span>
        </div>
      </form>
    </div>
  );
}
