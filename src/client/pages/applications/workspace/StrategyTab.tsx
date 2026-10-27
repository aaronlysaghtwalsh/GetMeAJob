import type { WorkspaceData } from '../../../lib/types';
import { Badge, Panel } from '../../../components/ui/primitives';
import { EvidenceMarker, useBrainIndex } from '../../../components/domain/evidence';
import { useQuery } from '../../../lib/query';
import type { CareerBrainDTO } from '../../../lib/types';
import { Bullets, NotYet, RegenerateButton, Section } from './shared';

const DECISION_LABEL: Record<string, string> = {
  use_existing: 'Use an existing resume',
  combine: 'Combine resumes',
  rebuild: 'Rebuild from your evidence',
};

export function StrategyTab({ data, busy }: { data: WorkspaceData; busy: boolean }) {
  const index = useBrainIndex();
  const brain = useQuery<{ brain: CareerBrainDTO }>('/api/brain');
  const art = data.artifacts.strategy;
  const id = data.application.id;
  if (!art) {
    return (
      <NotYet title="No strategy yet" appId={id} step="strategy" canRun={!busy && !!data.artifacts.fit}>
        The strategy decides how to position you before anything is written: what to lead with, which resume to start from, and how to answer likely objections.
      </NotYet>
    );
  }
  const s = art.content;
  const resumeLabel = (rid: string) => brain.data?.brain.resumeSources.find((r) => r.id === rid)?.label ?? 'Resume';
  const expLabel = (eid: string) => {
    const x = brain.data?.brain.experiences.find((e) => e.id === eid);
    return x ? `${x.title}, ${x.organization}` : eid;
  };
  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-panel border border-rule bg-surface px-6 py-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="text-[13px] text-graphite">Positioning, version {art.version}</div>
          <RegenerateButton appId={id} step="strategy" label="Rethink strategy" disabled={busy} />
        </div>
        <p className="mt-3 max-w-3xl font-display text-[24px] leading-snug font-medium text-ink">{s.positioning.primary}</p>
        <p className="mt-3 max-w-3xl text-[15px] leading-relaxed text-ink-soft">{s.positioning.secondary}</p>
        <p className="mt-4 max-w-3xl border-t border-rule pt-4 text-sm leading-relaxed text-graphite">{s.positioning.narrative}</p>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Lead with">
          <ul className="flex flex-col gap-3">
            {s.leadWith.map((l) => (
              <li key={l.point} className="text-sm">
                <div className="text-ink">
                  {l.point}
                  {l.evidenceIds.length > 0 && <EvidenceMarker ids={l.evidenceIds} index={index} />}
                </div>
                <div className="mt-0.5 text-[13px] text-graphite">{l.why}</div>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Play down">
          <ul className="flex flex-col gap-3">
            {s.deEmphasize.map((d) => (
              <li key={d.point} className="text-sm">
                <div className="text-ink">{d.point}</div>
                <div className="mt-0.5 text-[13px] text-graphite">{d.why}</div>
              </li>
            ))}
            {!s.deEmphasize.length && <li className="text-[13px] text-mist">Nothing to play down.</li>}
          </ul>
        </Panel>
      </div>

      <Panel title="Objections to expect">
        <div className="grid gap-3 md:grid-cols-2">
          {s.objections.map((o) => (
            <div key={o.objection} className="rounded-control bg-paper px-4 py-3">
              <div className="text-sm text-ink">
                {o.objection} <span className="text-[12px] text-graphite">({o.severity})</span>
              </div>
              <div className="mt-1.5 border-l-2 border-jade pl-3 text-[13px] text-ink-soft">
                {o.response}
                {o.evidenceIds.length > 0 && <EvidenceMarker ids={o.evidenceIds} index={index} />}
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Resume plan">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="ink">{DECISION_LABEL[s.baseResume.decision]}</Badge>
            {s.baseResume.sourceIds.map((rid) => (
              <Badge key={rid}>{resumeLabel(rid)}</Badge>
            ))}
          </div>
          <p className="mt-2 text-[13px] text-graphite">{s.baseResume.rationale}</p>
          <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[13px]">
            <dt className="text-graphite">Summary</dt>
            <dd className="text-ink">{s.resumePlan.includeSummary ? s.resumePlan.summaryFocus : 'No summary'}</dd>
            <dt className="text-graphite">Section order</dt>
            <dd className="text-ink capitalize">{s.resumePlan.sectionOrder.join(', ')}</dd>
            <dt className="text-graphite">Experience order</dt>
            <dd className="text-ink">{s.resumePlan.experienceOrder.map(expLabel).join('; ')}</dd>
          </dl>
        </Panel>
        <Panel title="Keywords">
          <div className="text-[13px] text-graphite">Will be used, because your evidence supports them</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {s.resumePlan.keywordsToCover.map((k) => (
              <span key={k.term} className="rounded-full bg-jade-tint px-2.5 py-0.5 text-[12.5px] text-jade-strong">
                {k.term}
              </span>
            ))}
          </div>
          <div className="mt-4 text-[13px] text-graphite">Will not be used: no evidence in your Career Brain</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {s.resumePlan.keywordsNotSupported.map((k) => (
              <span key={k} className="rounded-full bg-ink/[0.05] px-2.5 py-0.5 text-[12.5px] text-graphite line-through decoration-mist">
                {k}
              </span>
            ))}
            {!s.resumePlan.keywordsNotSupported.length && <span className="text-[13px] text-mist">None.</span>}
          </div>
        </Panel>
      </div>

      <Panel title="Cover letter angle">
        <p className="text-[15px] text-ink">{s.coverLetter.angle}</p>
        <dl className="mt-4 grid gap-x-6 gap-y-3 text-[13px] sm:grid-cols-2">
          {[
            ['Hook', s.coverLetter.hook],
            ['Why this company', s.coverLetter.whyCompany],
            ['Why this role', s.coverLetter.whyRole],
            ['Why you', s.coverLetter.whyMe],
            ['Why now', s.coverLetter.whyNow],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-graphite">{k}</dt>
              <dd className="mt-0.5 text-ink-soft">{v}</dd>
            </div>
          ))}
        </dl>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-3">
        <Section title="Company priorities">
          <Bullets items={s.companyPriorities.map((c) => <span key={c.priority}><span className="text-ink">{c.priority}.</span> {c.howToAddress}</span>)} />
        </Section>
        <Section title="Role priorities">
          <Bullets items={s.rolePriorities.map((c) => <span key={c.priority}><span className="text-ink">{c.priority}</span> <span className="text-[12px] text-mist">{c.requirementIds.join(', ')}</span>. {c.howToAddress}</span>)} />
        </Section>
        <Section title="Facts that would strengthen this">
          <Bullets items={s.questionsForApplicant.map((q) => <span key={q.question}><span className="text-ink">{q.question}</span> {q.why}</span>)} empty="Nothing missing." />
        </Section>
      </div>
    </div>
  );
}
