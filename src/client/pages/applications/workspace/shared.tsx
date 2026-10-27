import { useState, type ReactNode } from 'react';
import { LuRefreshCw, LuSparkles } from 'react-icons/lu';
import { api } from '../../../lib/api';
import { useAction } from '../../../lib/actions';
import type { PipelineStep } from '../../../../shared/constants';
import { Button, Field, Textarea, EmptyState } from '../../../components/ui/primitives';
import { Dialog } from '../../../components/ui/overlays';

export function refreshKeys(id: string) {
  return [`/api/applications/${id}`, '/api/applications', '/api/dashboard'];
}

/** Re-run a pipeline step, optionally with the applicant's direction ("shorter", "lead with sales"). */
export function RegenerateButton({ appId, step, label = 'Regenerate', disabled, variant = 'secondary', withGuidance = true }: { appId: string; step: PipelineStep; label?: string; disabled?: boolean; variant?: 'secondary' | 'ghost' | 'primary'; withGuidance?: boolean }) {
  const [open, setOpen] = useState(false);
  const [guidance, setGuidance] = useState('');
  const { run, busy } = useAction();
  const go = async (g?: string) => {
    const r = await run('regen', () => api.post(`/api/applications/${appId}/steps/${step}`, { guidance: g || undefined }), { refresh: refreshKeys(appId) });
    if (r) {
      setOpen(false);
      setGuidance('');
    }
  };
  return (
    <>
      <Button variant={variant} size="sm" icon={<LuRefreshCw className="size-3.5" />} disabled={disabled} loading={busy === 'regen'} onClick={() => (withGuidance ? setOpen(true) : void go())}>
        {label}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={label}
        description="A new version is created; the current one is kept. Add direction if you want something specific."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" loading={busy === 'regen'} onClick={() => void go(guidance)}>
              Generate new version
            </Button>
          </>
        }
      >
        <Field label="Direction" optional hint="For example: lead with the sales experience; make it shorter; mention the loyalty product.">
          <Textarea value={guidance} onChange={(e) => setGuidance(e.target.value)} rows={3} autoFocus />
        </Field>
      </Dialog>
    </>
  );
}

export function NotYet({ title, children, appId, step, canRun }: { title: string; children: ReactNode; appId: string; step: PipelineStep; canRun: boolean }) {
  const { run, busy } = useAction();
  return (
    <div className="rounded-panel border border-dashed border-rule-strong bg-surface">
      <EmptyState
        icon={<LuSparkles />}
        title={title}
        action={
          canRun && (
            <Button variant="primary" loading={busy === 'run'} onClick={() => void run('run', () => api.post(`/api/applications/${appId}/steps/${step}`, {}), { refresh: refreshKeys(appId) })}>
              Run this step
            </Button>
          )
        }
      >
        {children}
      </EmptyState>
    </div>
  );
}

export function Section({ title, children, aside, className }: { title: ReactNode; children: ReactNode; aside?: ReactNode; className?: string }) {
  return (
    <section className={className}>
      <div className="mb-2.5 flex items-baseline justify-between gap-3">
        <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Bullets({ items, empty = 'None.' }: { items: ReactNode[]; empty?: string }) {
  if (!items.length) return <p className="text-[13px] text-mist">{empty}</p>;
  return (
    <ul className="flex flex-col gap-2">
      {items.map((it, i) => (
        <li key={i} className="flex gap-2.5 text-sm leading-relaxed text-ink-soft">
          <span className="mt-[9px] size-1 shrink-0 rounded-full bg-mist" />
          <span className="min-w-0">{it}</span>
        </li>
      ))}
    </ul>
  );
}
