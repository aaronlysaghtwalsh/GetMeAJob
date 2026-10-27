import { useState } from 'react';
import { LuCheck, LuCircleCheck, LuCircle, LuSend, LuTriangleAlert, LuX } from 'react-icons/lu';
import { api } from '../../../lib/api';
import { useQuery } from '../../../lib/query';
import { useAction } from '../../../lib/actions';
import type { WorkspaceData } from '../../../lib/types';
import { formatDate, localDateInput, sentence } from '../../../lib/format';
import { Badge, Button, Callout, Checkbox, Field, Input, Panel } from '../../../components/ui/primitives';
import { Dialog } from '../../../components/ui/overlays';
import { ScoreBar, ScoreFigure } from '../../../components/domain/provenance';
import { DiffView } from '../../../components/domain/work';
import { cn } from '../../../components/ui/cn';
import { Bullets, NotYet, RegenerateButton, Section, refreshKeys } from './shared';

const SCORE_LABEL: Record<string, string> = {
  resume: 'Resume',
  ats: 'ATS compatibility',
  recruiterAppeal: 'Recruiter appeal',
  coverLetter: 'Cover letter',
  questions: 'Application answers',
  companyAlignment: 'Company alignment',
  evidence: 'Evidence strength',
  consistency: 'Consistency',
};
const VERDICT = {
  ready: { label: 'Ready to submit', cls: 'bg-jade text-white' },
  almost_ready: { label: 'Almost ready', cls: 'bg-ochre-tint text-ochre' },
  not_ready: { label: 'Not ready', cls: 'bg-brick-tint text-brick' },
} as const;

function SubmitPanel({ data }: { data: WorkspaceData }) {
  const id = data.application.id;
  const check = useQuery<{ ok: boolean; problems: string[] }>(`/api/applications/${id}/submission-check`);
  const [open, setOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [date, setDate] = useState(localDateInput());
  const [noLetter, setNoLetter] = useState(false);
  const { run, busy } = useAction();
  const app = data.application;
  if (app.dateApplied) {
    return (
      <Panel title="Submitted">
        <p className="text-sm text-ink">
          You marked this as submitted on {formatDate(app.dateApplied)}. The approved versions were saved with the application.
        </p>
      </Panel>
    );
  }
  const letterUnapproved = !!data.artifacts.cover_letter && data.artifacts.cover_letter.status !== 'approved';
  const problems = check.data?.problems ?? [];
  const onlyLetter = problems.length === 1 && letterUnapproved && /cover letter/.test(problems[0]);
  return (
    <Panel title="Submit" description="GetMeAJob never submits for you. Apply on the employer’s site, then record it here.">
      <ul className="flex flex-col gap-2">
        {problems.map((p) => (
          <li key={p} className="flex gap-2 text-[13px] text-ink-soft">
            <LuCircle className="mt-0.5 size-4 shrink-0 text-ochre" /> {p}
          </li>
        ))}
        {check.data?.ok && (
          <li className="flex gap-2 text-[13px] text-ink">
            <LuCircleCheck className="mt-0.5 size-4 shrink-0 text-jade" /> Everything you are sending is approved.
          </li>
        )}
      </ul>
      <Button className="mt-4 w-full" variant="primary" icon={<LuSend className="size-4" />} disabled={!check.data?.ok && !onlyLetter} onClick={() => setOpen(true)}>
        Mark as submitted
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Record your submission"
        description="Confirm you submitted the application yourself. The approved versions are locked into this application’s record."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!confirmed || (letterUnapproved && !noLetter)}
              loading={busy === 'submit'}
              onClick={async () => {
                // Today means "just now"; an earlier date is recorded at local noon so it stays on that calendar day.
                const submittedAt = date === localDateInput() ? new Date().toISOString() : new Date(`${date}T12:00`).toISOString();
                const r = await run('submit', () => api.post(`/api/applications/${id}/submit`, { confirm: true, dateApplied: date, submittedAt, withoutCoverLetter: noLetter }), {
                  refresh: [...refreshKeys(id), `/api/applications/${id}/submission-check`],
                  success: 'Marked as submitted. A follow-up reminder is set for a week from now.',
                });
                if (r) setOpen(false);
              }}
            >
              Mark as submitted
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Date submitted">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="max-w-48" />
          </Field>
          {letterUnapproved && <Checkbox label="I am submitting without the cover letter" checked={noLetter} onChange={setNoLetter} />}
          <Checkbox label="I submitted this application on the employer’s site" checked={confirmed} onChange={setConfirmed} />
        </div>
      </Dialog>
    </Panel>
  );
}

export function ReviewTab({ data, busy }: { data: WorkspaceData; busy: boolean }) {
  const art = data.artifacts.review;
  const id = data.application.id;
  const { run, busy: acting } = useAction();
  if (!art) {
    return (
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <NotYet title="No readiness review yet" appId={id} step="review" canRun={!busy && !!data.artifacts.resume}>
          A final pass from a recruiter’s and hiring manager’s point of view, with concrete edits you can accept or reject.
        </NotYet>
        <SubmitPanel data={data} />
      </div>
    );
  }
  const r = art.content;
  const stale = r.reviewed.resumeId !== data.artifacts.resume?.id || r.reviewed.coverLetterId !== (data.artifacts.cover_letter?.id ?? null);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-w-0 flex-col gap-6">
        {stale && (
          <Callout tone="cobalt" title="Your documents changed after this review" action={<RegenerateButton appId={id} step="review" label="Review again" disabled={busy} withGuidance={false} />}>
            Scores below describe the earlier versions.
          </Callout>
        )}
        <Panel>
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="max-w-xl">
              <span className={cn('inline-flex rounded-full px-3 py-1 text-sm font-medium', VERDICT[r.verdict].cls)}>{VERDICT[r.verdict].label}</span>
              <p className="mt-3 text-[15px] leading-relaxed text-ink">{r.verdictReason}</p>
            </div>
            <ScoreFigure value={r.overall} label="Application readiness" />
          </div>
        </Panel>

        <Panel title="Scores" actions={!stale && <RegenerateButton appId={id} step="review" label="Review again" disabled={busy} withGuidance={false} variant="ghost" />}>
          <div className="grid gap-x-8 gap-y-5 md:grid-cols-2">
            {Object.entries(r.scores).map(([k, v]) => (
              <ScoreBar key={k} label={SCORE_LABEL[k] ?? k} value={v.score} hint={v.reasoning} />
            ))}
          </div>
        </Panel>

        <div className="grid gap-6 md:grid-cols-2">
          <Section title="Biggest strengths">
            <Bullets items={r.strengths} />
          </Section>
          <Section title="Biggest weaknesses">
            <Bullets items={r.weaknesses} />
          </Section>
        </div>

        {r.consistency.length > 0 && (
          <Section title="Consistency">
            <div className="flex flex-col gap-2">
              {r.consistency.map((c, i) => (
                <Callout key={i} tone={c.severity === 'blocker' ? 'brick' : 'ochre'} icon={<LuTriangleAlert />}>
                  {c.message} <span className="text-graphite">({c.where.join(', ')})</span>
                </Callout>
              ))}
            </div>
          </Section>
        )}

        <Section title="Recommended changes">
          <div className="flex flex-col gap-3">
            {r.recommendations.map((rec) => {
              const decision = r.decisions[rec.id];
              return (
                <div key={rec.id} className={cn('rounded-panel border bg-surface px-5 py-4', decision ? 'border-rule opacity-70' : 'border-rule')}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-ink">{rec.title}</span>
                        <Badge tone={rec.severity === 'critical' ? 'brick' : rec.severity === 'important' ? 'ochre' : 'neutral'}>{sentence(rec.severity)}</Badge>
                        <span className="text-[12px] text-mist">{sentence(rec.target)}</span>
                      </div>
                      <p className="mt-1 text-[13px] text-graphite">{rec.detail}</p>
                    </div>
                    {decision ? (
                      <Badge tone={decision === 'accepted' ? 'jade' : 'neutral'}>{decision === 'accepted' ? 'Accepted' : 'Dismissed'}</Badge>
                    ) : (
                      <div className="flex gap-1.5">
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<LuX className="size-3.5" />}
                          onClick={() => void run(`x${rec.id}`, () => api.post(`/api/artifacts/${art.id}/recommendations/${rec.id}`, { decision: 'rejected' }), { refresh: refreshKeys(id) })}
                        >
                          Dismiss
                        </Button>
                        {rec.applicable && (
                          <Button
                            size="sm"
                            variant="accent"
                            icon={<LuCheck className="size-3.5" />}
                            loading={acting === `a${rec.id}`}
                            onClick={() =>
                              void run(`a${rec.id}`, () => api.post(`/api/artifacts/${art.id}/recommendations/${rec.id}`, { decision: 'accepted' }), {
                                refresh: refreshKeys(id),
                                success: 'Applied as a new version.',
                              })
                            }
                          >
                            Apply
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                  {rec.applicable && rec.find && (
                    <div className="mt-3 rounded-control bg-paper px-3 py-2">
                      <DiffView before={rec.find} after={rec.replace} />
                    </div>
                  )}
                </div>
              );
            })}
            {!r.recommendations.length && <p className="text-[13px] text-mist">No changes recommended.</p>}
          </div>
        </Section>
      </div>
      <aside>
        <SubmitPanel data={data} />
      </aside>
    </div>
  );
}
