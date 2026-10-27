import { useState, type ReactNode } from 'react';
import { LuCheck, LuCircle, LuCircleAlert, LuCircleCheck, LuMinus, LuShieldCheck, LuThumbsDown, LuThumbsUp, LuTriangleAlert, LuX } from 'react-icons/lu';
import { api, ApiError } from '../../lib/api';
import { invalidate } from '../../lib/query';
import type { IntegrityReport, TaskDTO, VersionMeta, WritingLint } from '../../lib/types';
import { FEEDBACK_TAGS, FEEDBACK_TAG_LABEL } from '../../../shared/constants';
import { diffWords } from '../../../shared/diff';
import { Badge, Button, Checkbox, Spinner, Textarea } from '../ui/primitives';
import { Dialog, useToast } from '../ui/overlays';
import { cn } from '../ui/cn';
import { formatDateTime, relativeTime } from '../../lib/format';

/* Task progress ------------------------------------------------------------------------------------------- */

export function StepIcon({ status }: { status: string }) {
  if (status === 'done') return <LuCircleCheck className="size-4 text-jade" />;
  if (status === 'running') return <span className="running-dot flex size-4 items-center justify-center rounded-full bg-cobalt-tint"><span className="size-1.5 rounded-full bg-cobalt" /></span>;
  if (status === 'failed') return <LuCircleAlert className="size-4 text-brick" />;
  if (status === 'skipped') return <LuMinus className="size-4 text-mist" />;
  return <LuCircle className="size-4 text-rule-strong" />;
}

export function TaskProgressCard({ task, title, onCancel }: { task: TaskDTO; title?: ReactNode; onCancel?: () => void }) {
  const steps = task.progress.steps;
  const done = steps.filter((s) => s.status === 'done' || s.status === 'skipped').length;
  return (
    <div className="rounded-panel border border-cobalt/25 bg-surface px-5 py-4 shadow-[0_1px_0_rgba(45,91,208,0.06)]">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Spinner className="size-4 text-cobalt" />
          <div>
            <div className="text-sm font-medium text-ink">{title ?? 'Working on it'}</div>
            <div className="text-[12.5px] text-graphite">
              {task.status === 'queued' ? 'Waiting to start…' : task.progress.message || `${done} of ${steps.length} steps done`}
            </div>
          </div>
        </div>
        {onCancel && (
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
      {steps.length > 1 && (
        <ol className="mt-3.5 grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {steps.map((s) => (
            <li key={s.key} className="flex items-start gap-2 text-[13px]">
              <span className="mt-px">
                <StepIcon status={s.status} />
              </span>
              <span className="min-w-0">
                <span className={cn(s.status === 'pending' ? 'text-mist' : 'text-ink')}>{s.label}</span>
                {s.detail && <span className="block truncate text-[12px] text-graphite">{s.detail}</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/* Integrity ------------------------------------------------------------------------------------------------- */

export function IntegrityPanel({ report }: { report: IntegrityReport }) {
  const blockers = report.issues.filter((i) => i.severity === 'blocker');
  const warnings = report.issues.filter((i) => i.severity === 'warning');
  return (
    <div>
      <div className={cn('flex items-start gap-2.5 rounded-control px-3 py-2.5', blockers.length ? 'bg-brick-tint/70' : 'bg-jade-tint/60')}>
        {blockers.length ? <LuTriangleAlert className="mt-0.5 size-4 shrink-0 text-brick" /> : <LuShieldCheck className="mt-0.5 size-4 shrink-0 text-jade" />}
        <div className="text-[13px] leading-snug">
          <div className="font-medium text-ink">
            {blockers.length ? `${blockers.length} claim${blockers.length === 1 ? '' : 's'} not supported by your evidence` : 'Every claim is backed by your evidence'}
          </div>
          <div className="text-graphite">
            {blockers.length ? 'Fix or remove these before approving.' : `${report.checkedClaims} line${report.checkedClaims === 1 ? '' : 's'} checked against your Career Brain.`}
          </div>
        </div>
      </div>
      {report.issues.length > 0 && (
        <ul className="mt-2.5 flex flex-col gap-2">
          {[...blockers, ...warnings].map((i, idx) => (
            <li key={idx} className="flex gap-2 text-[12.5px] leading-snug">
              <span className={cn('mt-[5px] size-1.5 shrink-0 rounded-full', i.severity === 'blocker' ? 'bg-brick' : 'bg-ochre')} />
              <span className="min-w-0">
                <span className="text-ink">{i.message}</span>
                {i.text && i.code !== 'unknown_skill' && <span className="mt-0.5 block truncate text-graphite italic">“{i.text}”</span>}
                <span className="block text-[11.5px] text-mist">{i.location}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function WritingPanel({ lint }: { lint: WritingLint }) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-[13px] text-ink-soft">Natural writing</span>
        <span className={cn('tabular text-[13px] font-semibold', lint.score >= 85 ? 'text-jade-strong' : lint.score >= 70 ? 'text-cobalt' : 'text-ochre')}>{lint.score}</span>
      </div>
      <p className="mt-1 text-[12.5px] text-graphite">
        {lint.stats.words} words, {lint.stats.sentences} sentences, average {lint.stats.avgSentenceLength} words per sentence.
      </p>
      {lint.flags.length ? (
        <ul className="mt-2 flex flex-col gap-1.5">
          {lint.flags.map((f) => (
            <li key={f.phrase} className="text-[12.5px] leading-snug">
              <span className="rounded bg-ochre-tint px-1 text-ochre">{f.phrase}</span>
              {f.count > 1 && <span className="text-mist"> ×{f.count}</span>} <span className="text-graphite">{f.suggestion}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-[12.5px] text-jade-strong">No clichés, filler or AI-style phrasing detected.</p>
      )}
    </div>
  );
}

/* Feedback --------------------------------------------------------------------------------------------------- */

export function FeedbackWidget({ artifactId }: { artifactId: string }) {
  const toast = useToast();
  const [rating, setRating] = useState<'up' | 'down' | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const send = async (r: 'up' | 'down', withDetails = false) => {
    setBusy(true);
    try {
      await api.post(`/api/artifacts/${artifactId}/feedback`, { rating: r, tags: withDetails ? tags : [], comment: withDetails ? comment : '' });
      setSent(true);
      toast(r === 'up' ? 'Thanks, noted.' : 'Feedback saved. It will be applied the next time you regenerate.', 'success');
    } catch (err) {
      toast((err as ApiError).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  if (sent) return <p className="text-[12.5px] text-graphite">Feedback saved. Regenerate to apply it.</p>;
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="text-[13px] text-ink-soft">How is this version?</span>
        <button type="button" aria-label="Good" onClick={() => void send('up')} className="rounded p-1.5 text-graphite hover:bg-jade-tint hover:text-jade-strong">
          <LuThumbsUp className="size-4" />
        </button>
        <button type="button" aria-label="Needs improvement" onClick={() => setRating('down')} className={cn('rounded p-1.5 hover:bg-brick-tint hover:text-brick', rating === 'down' ? 'bg-brick-tint text-brick' : 'text-graphite')}>
          <LuThumbsDown className="size-4" />
        </button>
      </div>
      {rating === 'down' && (
        <div className="mt-2.5">
          <div className="flex flex-wrap gap-1.5">
            {FEEDBACK_TAGS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTags((x) => (x.includes(t) ? x.filter((y) => y !== t) : [...x, t]))}
                className={cn('rounded-full border px-2.5 py-0.5 text-[12px]', tags.includes(t) ? 'border-ink bg-ink text-white' : 'border-rule-strong text-ink-soft hover:border-mist')}
              >
                {FEEDBACK_TAG_LABEL[t]}
              </button>
            ))}
          </div>
          <Textarea className="mt-2 min-h-16 text-[13px]" placeholder="What should change? (optional)" value={comment} onChange={(e) => setComment(e.target.value)} />
          <div className="mt-2 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setRating(null)}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" loading={busy} onClick={() => void send('down', true)}>
              Save feedback
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/* Versions ------------------------------------------------------------------------------------------------------ */

export function VersionStatus({ v }: { v: VersionMeta }) {
  if (v.status === 'approved') return <Badge tone="jade"><LuCheck className="size-3" /> Approved</Badge>;
  if (v.status === 'superseded') return <Badge>Previously approved</Badge>;
  return <Badge tone="neutral">Draft</Badge>;
}

export function VersionList({ versions, selectedId, onSelect, compareId, onCompare }: { versions: VersionMeta[]; selectedId: string; onSelect: (id: string) => void; compareId?: string | null; onCompare?: (id: string | null) => void }) {
  return (
    <ol className="flex flex-col">
      {versions.map((v) => (
        <li key={v.id}>
          <div className={cn('flex items-start gap-2 rounded-control px-2.5 py-2', v.id === selectedId ? 'bg-ink/[0.06]' : 'hover:bg-ink/[0.03]')}>
            <button type="button" onClick={() => onSelect(v.id)} className="min-w-0 flex-1 text-left">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[13px] font-medium text-ink">Version {v.version}</span>
                <VersionStatus v={v} />
              </div>
              <div className="mt-0.5 truncate text-[12px] text-graphite" title={v.changeSummary}>
                {v.changeSummary || (v.createdBy === 'user' ? 'Edited by you' : 'Generated')}
              </div>
              <div className="text-[11.5px] text-mist" title={formatDateTime(v.createdAt)}>
                {v.createdBy === 'user' ? 'You' : 'AI'}, {relativeTime(v.createdAt)}
              </div>
            </button>
            {onCompare && v.id !== selectedId && (
              <button type="button" onClick={() => onCompare(compareId === v.id ? null : v.id)} className={cn('mt-0.5 rounded px-1.5 py-0.5 text-[11.5px]', compareId === v.id ? 'bg-cobalt-tint text-cobalt' : 'text-graphite hover:text-ink')}>
                {compareId === v.id ? 'Comparing' : 'Compare'}
              </button>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function DiffView({ before, after }: { before: string; after: string }) {
  const parts = diffWords(before, after);
  return (
    <div className="font-doc text-[13px] leading-relaxed whitespace-pre-wrap text-ink">
      {parts.map((p, i) =>
        p.type === 'same' ? (
          <span key={i}>{p.text}</span>
        ) : p.type === 'added' ? (
          <ins key={i} className="rounded-sm bg-jade-tint text-jade-strong no-underline">
            {p.text}
          </ins>
        ) : (
          <del key={i} className="rounded-sm bg-brick-tint text-brick">
            {p.text}
          </del>
        ),
      )}
    </div>
  );
}

/* Approve control -------------------------------------------------------------------------------------------------- */

export function ApproveButton({
  artifactId,
  status,
  blockers,
  refresh,
  sensitive,
}: {
  artifactId: string;
  status: string;
  blockers: number;
  refresh: string;
  /** Sensitive answers (work authorization, salary, legal…) need an explicit confirmation. */
  sensitive?: { question: string; answer: string };
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [checked, setChecked] = useState(false);
  const approve = async (confirmSensitive: boolean) => {
    setBusy(true);
    try {
      await api.post(`/api/artifacts/${artifactId}/approve`, confirmSensitive ? { confirmSensitive: true } : {});
      invalidate(refresh);
      toast('Approved.', 'success');
      setConfirming(false);
    } catch (err) {
      toast((err as ApiError).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  if (status === 'approved') {
    return (
      <span className="inline-flex h-9 items-center gap-1.5 rounded-control bg-jade-tint px-3 text-sm font-medium text-jade-strong">
        <LuCheck className="size-4" /> Approved
      </span>
    );
  }
  return (
    <>
      <Button
        variant="accent"
        loading={busy && !confirming}
        disabled={blockers > 0}
        title={blockers ? 'Fix the integrity issues first' : 'Approve this version for submission'}
        onClick={() => {
          if (sensitive) {
            setChecked(false);
            setConfirming(true);
          } else void approve(false);
        }}
        icon={<LuCheck className="size-4" />}
      >
        Approve
      </Button>
      {sensitive && (
        <Dialog
          open={confirming}
          onClose={() => setConfirming(false)}
          title="Approve a sensitive answer"
          description="Employers can rely on answers about work authorization, sponsorship, pay, legal or personal matters. Check it is true for you."
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
              <Button variant="accent" disabled={!checked} loading={busy} icon={<LuCheck className="size-4" />} onClick={() => void approve(true)}>
                Approve answer
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-4">
            <div className="rounded-control bg-paper px-4 py-3">
              <div className="text-[13px] text-graphite">{sensitive.question}</div>
              <div className="mt-1.5 text-sm text-ink">{sensitive.answer}</div>
            </div>
            <Checkbox label="I checked this answer and it is accurate for me" checked={checked} onChange={setChecked} />
          </div>
        </Dialog>
      )}
    </>
  );
}

export function StatusPill({ status }: { status: 'pass' | 'warn' | 'fail' | 'good' | 'ok' | 'weak' }) {
  const map = {
    pass: { cls: 'text-jade-strong', icon: <LuCheck className="size-3.5" /> },
    good: { cls: 'text-jade-strong', icon: <LuCheck className="size-3.5" /> },
    warn: { cls: 'text-ochre', icon: <LuTriangleAlert className="size-3.5" /> },
    ok: { cls: 'text-cobalt', icon: <LuMinus className="size-3.5" /> },
    fail: { cls: 'text-brick', icon: <LuX className="size-3.5" /> },
    weak: { cls: 'text-brick', icon: <LuX className="size-3.5" /> },
  }[status];
  return <span className={cn('inline-flex items-center', map.cls)}>{map.icon}</span>;
}
