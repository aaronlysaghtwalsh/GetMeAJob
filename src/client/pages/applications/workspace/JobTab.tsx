import { useState } from 'react';
import type { WorkspaceData } from '../../../lib/types';
import { sentence } from '../../../lib/format';
import { Badge, Panel } from '../../../components/ui/primitives';
import { cn } from '../../../components/ui/cn';
import { Bullets, NotYet, RegenerateButton, Section } from './shared';

export function JobTab({ data, busy }: { data: WorkspaceData; busy: boolean }) {
  const intel = data.job.intelligence;
  const [showRaw, setShowRaw] = useState(false);
  const id = data.application.id;
  if (!intel) {
    return (
      <NotYet title="The job has not been analyzed yet" appId={id} step="job" canRun={!busy}>
        Analysis turns the posting into requirements, keywords and likely screening criteria.
      </NotYet>
    );
  }
  const required = intel.requirements.filter((r) => r.type === 'required');
  const preferred = intel.requirements.filter((r) => r.type === 'preferred');
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-w-0 flex-col gap-6">
        <Panel title="What the job actually is" actions={<RegenerateButton appId={id} step="job" label="Re-analyze" disabled={busy} withGuidance={false} />}>
          <p className="text-[15px] leading-relaxed text-ink">{intel.summary}</p>
          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-3">
            {[
              ['Seniority', intel.seniority],
              ['Experience', intel.experienceYears || 'Not stated'],
              ['Education', intel.education || 'Not stated'],
              ['Customer-facing', intel.customerFacing.level],
              ['Travel', intel.travel || 'Not stated'],
              ['Sponsorship', intel.sponsorship.stance],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-graphite">{k}</dt>
                <dd className="text-ink">{sentence(String(v))}</dd>
              </div>
            ))}
          </dl>
          {intel.sponsorship.quote && <p className="mt-3 rounded-control bg-paper px-3 py-2 text-[13px] text-ink-soft italic">“{intel.sponsorship.quote}”</p>}
        </Panel>

        <Panel title="Requirements" description="Numbered so fit analysis and strategy can refer to them.">
          <div className="flex flex-col gap-5">
            {[
              ['Required', required],
              ['Preferred', preferred],
            ].map(([label, list]) =>
              (list as typeof required).length ? (
                <div key={label as string}>
                  <div className="mb-2 text-[13px] font-medium text-graphite">{label as string}</div>
                  <ul className="flex flex-col gap-2">
                    {(list as typeof required).map((r) => (
                      <li key={r.id} className="flex gap-3 text-sm">
                        <span className="mt-px w-7 shrink-0 text-[12px] font-medium text-mist tabular">{r.id}</span>
                        <span className="min-w-0 text-ink-soft">
                          {r.text}
                          {r.keywords.length > 0 && (
                            <span className="mt-1 flex flex-wrap gap-1">
                              {r.keywords.map((k) => (
                                <span key={k} className="rounded bg-ink/[0.05] px-1.5 text-[11.5px] text-graphite">
                                  {k}
                                </span>
                              ))}
                            </span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null,
            )}
          </div>
        </Panel>

        <Panel title="Responsibilities">
          <Bullets
            items={intel.responsibilities.map((r) => (
              <span key={r.text}>
                {r.text} {r.importance === 'core' && <Badge className="ml-1">core</Badge>}
              </span>
            ))}
          />
        </Panel>

        <Panel title="Original posting" actions={<button type="button" className="text-[13px] text-cobalt hover:underline" onClick={() => setShowRaw(!showRaw)}>{showRaw ? 'Hide' : 'Show'}</button>}>
          {showRaw ? <pre className="font-sans text-[13px] leading-relaxed whitespace-pre-wrap text-ink-soft">{data.job.rawText}</pre> : <p className="text-[13px] text-graphite">Kept exactly as provided.</p>}
        </Panel>
      </div>

      <aside className="flex flex-col gap-6">
        <Section title="Keywords">
          <div className="flex flex-wrap gap-1.5">
            {intel.keywords.map((k) => (
              <span
                key={k.term}
                title={k.variants.length ? `Also: ${k.variants.join(', ')}` : undefined}
                className={cn('rounded-full px-2.5 py-0.5 text-[12.5px]', k.weight === 'high' ? 'bg-ink text-white' : k.weight === 'medium' ? 'bg-ink/[0.08] text-ink' : 'bg-ink/[0.04] text-graphite')}
              >
                {k.term}
              </span>
            ))}
          </div>
          <p className="mt-2 text-[12px] text-mist">Darker means more central to the posting.</p>
        </Section>
        <Section title="Likely screening criteria">
          <Bullets
            items={intel.screeningCriteria.map((s) => (
              <span key={s.criterion}>
                <span className="block text-ink">{s.criterion}</span>
                <span className="block text-[13px] text-graphite">{s.why}</span>
              </span>
            ))}
          />
        </Section>
        <Section title="What they may really need">
          <p className="mb-2 text-[12px] text-mist">Interpretations of the wording, not facts.</p>
          <Bullets
            items={intel.hiddenPriorities.map((h) => (
              <span key={h.insight}>
                {h.insight} <span className="text-[12px] text-mist">({h.confidence} confidence; based on {h.basis})</span>
              </span>
            ))}
          />
        </Section>
        {intel.redFlags.length > 0 && (
          <Section title="Watch out for">
            <Bullets items={intel.redFlags} />
          </Section>
        )}
      </aside>
    </div>
  );
}
