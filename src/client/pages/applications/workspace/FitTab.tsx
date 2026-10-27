import { LuTriangleAlert, LuOctagonAlert } from 'react-icons/lu';
import type { WorkspaceData } from '../../../lib/types';
import { FIT_DIMENSION_LABEL, type FitDimension } from '../../../../shared/constants';
import { minutes, sentence } from '../../../lib/format';
import { Callout, Panel } from '../../../components/ui/primitives';
import { ScoreBar, ScoreFigure, TierBadge } from '../../../components/domain/provenance';
import { EvidenceMarker, useBrainIndex } from '../../../components/domain/evidence';
import { cn } from '../../../components/ui/cn';
import { Bullets, NotYet, RegenerateButton, Section } from './shared';

const STATUS_STYLE: Record<string, string> = {
  strong: 'bg-jade-tint text-jade-strong',
  partial: 'bg-cobalt-tint text-cobalt',
  transferable: 'bg-cobalt-tint/60 text-cobalt',
  gap: 'bg-brick-tint text-brick',
  unknown: 'bg-ink/[0.06] text-graphite',
};
const SEVERITY_STYLE: Record<string, string> = {
  minor: 'text-graphite',
  moderate: 'text-ochre',
  major: 'text-brick',
  dealbreaker: 'text-brick font-medium',
};

export function FitTab({ data, busy }: { data: WorkspaceData; busy: boolean }) {
  const index = useBrainIndex();
  const art = data.artifacts.fit;
  const id = data.application.id;
  const intel = data.job.intelligence;
  if (!art || !intel) {
    return (
      <NotYet title="No fit analysis yet" appId={id} step="fit" canRun={!busy && !!intel}>
        Fit analysis compares every requirement with your evidence and simulates how a recruiter and hiring manager would read your application.
      </NotYet>
    );
  }
  const f = art.content;
  return (
    <div className="flex flex-col gap-6">
      {f.guardrails.map((g) => (
        <Callout key={g.rule} tone={g.severity === 'blocker' ? 'brick' : 'ochre'} icon={g.severity === 'blocker' ? <LuOctagonAlert /> : <LuTriangleAlert />}>
          {g.message}
        </Callout>
      ))}

      <Panel>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-6 md:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0">
            <TierBadge tier={f.finalTier} size="lg" />
            <p className="mt-3 font-display text-[22px] leading-snug text-ink">{f.verdict.headline}</p>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-graphite">{f.verdict.rationale}</p>
          </div>
          <div className="flex gap-8 md:flex-col md:gap-5">
            <ScoreFigure value={f.scores.overall} label="Overall fit" />
            <ScoreFigure value={f.scores.requiredCoverage} label="Required qualifications covered" suffix="%" />
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-rule pt-4">
          <p className="max-w-3xl text-[12.5px] text-graphite">
            Coverage counts a strong match fully, a partial match as 60% and a transferable one as 45%. Overall fit blends coverage of all {intel.requirements.length} requirements ({f.scores.requirementCoverage}%, required ones count double) with the
            dimension scores below. Every score cites evidence or says it is based on your preferences.
          </p>
          <RegenerateButton appId={id} step="fit" label="Re-analyze" disabled={busy} />
        </div>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Dimensions">
          <div className="flex flex-col gap-4">
            {f.dimensions.map((d) => (
              <div key={d.key}>
                <ScoreBar
                  value={d.score}
                  muted={d.basis === 'unknown'}
                  label={
                    <span>
                      {FIT_DIMENSION_LABEL[d.key as FitDimension]}
                      {d.basis === 'preference' && <span className="ml-1.5 text-[11.5px] text-mist">from your preferences</span>}
                    </span>
                  }
                  hint={
                    <>
                      {d.assessment}
                      {d.evidenceIds.length > 0 && <EvidenceMarker ids={d.evidenceIds} index={index} />}
                    </>
                  }
                />
              </div>
            ))}
          </div>
        </Panel>
        <div className="flex flex-col gap-6">
          <Panel title="Recruiter view">
            <p className="text-sm leading-relaxed text-ink">{f.recruiterView.firstImpression}</p>
            <p className="mt-2 text-[13px] text-graphite">
              Would advance: <span className="font-medium text-ink">{sentence(f.recruiterView.wouldAdvance)}</span>. {f.recruiterView.reasoning}
            </p>
          </Panel>
          <Panel title="Hiring manager view">
            <p className="text-[13px] text-graphite">
              Can do the work: <span className="font-medium text-ink">{sentence(f.hiringManagerView.canDoTheWork)}</span>. {f.hiringManagerView.reasoning}
            </p>
          </Panel>
          <Panel title="ATS view">
            <p className="text-[13px] text-graphite">
              Risk: <span className="font-medium text-ink">{sentence(f.atsView.risk)}</span>. {f.atsView.notes}
            </p>
          </Panel>
        </div>
      </div>

      <Panel title="Requirement by requirement" bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-rule bg-paper/60 text-[12.5px] text-graphite">
              <tr>
                <th className="w-12 px-5 py-2.5 font-medium" />
                <th className="px-3 py-2.5 font-medium">Requirement</th>
                <th className="px-3 py-2.5 font-medium">Match</th>
                <th className="px-3 py-2.5 font-medium">Why</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-rule">
              {f.requirementMatches.map((m) => {
                const req = intel.requirements.find((r) => r.id === m.requirementId);
                return (
                  <tr key={m.requirementId} className="align-top">
                    <td className="px-5 py-3 text-[12px] font-medium text-mist tabular">{m.requirementId}</td>
                    <td className="max-w-xs px-3 py-3 text-ink-soft">
                      {req?.text}
                      <div className="mt-0.5 text-[12px] text-mist">{req?.type}</div>
                    </td>
                    <td className="px-3 py-3">
                      <span className={cn('rounded-full px-2 py-0.5 text-[12px] font-medium whitespace-nowrap', STATUS_STYLE[m.status])}>{sentence(m.status)}</span>
                    </td>
                    <td className="px-3 py-3 text-[13px] text-graphite">
                      {m.explanation}
                      {m.evidenceIds.length > 0 && <EvidenceMarker ids={m.evidenceIds} index={index} />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Strengths">
          <Bullets
            items={f.strengths.map((s) => (
              <span key={s.point}>
                {s.point}
                {s.evidenceIds.length > 0 && <EvidenceMarker ids={s.evidenceIds} index={index} />}
              </span>
            ))}
          />
        </Section>
        <Section title="Gaps and how to handle them">
          <ul className="flex flex-col gap-3">
            {f.gaps.map((g) => (
              <li key={g.point} className="text-sm">
                <div className="text-ink">
                  {g.point} <span className={cn('text-[12px]', SEVERITY_STYLE[g.severity])}>({g.severity})</span>
                </div>
                <div className="mt-0.5 text-[13px] text-graphite">{g.mitigation}</div>
              </li>
            ))}
            {!f.gaps.length && <li className="text-[13px] text-mist">No significant gaps.</li>}
          </ul>
        </Section>
      </div>

      <Section title="Likely concerns and your answer">
        <div className="grid gap-3 md:grid-cols-2">
          {[...f.recruiterView.concerns.map((c) => ({ ...c, who: 'Recruiter' })), ...f.hiringManagerView.concerns.map((c) => ({ ...c, who: 'Hiring manager' }))].map((c, i) => (
            <div key={i} className="rounded-panel border border-rule bg-surface px-4 py-3.5">
              <div className="text-[12px] text-graphite">
                {c.who}, <span className={SEVERITY_STYLE[c.severity]}>{c.severity}</span>
              </div>
              <div className="mt-1 text-sm text-ink">{c.concern}</div>
              <div className="mt-2 border-l-2 border-jade pl-3 text-[13px] text-ink-soft">
                {c.response}
                {c.evidenceIds.length > 0 && <EvidenceMarker ids={c.evidenceIds} index={index} />}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <div className="grid gap-6 md:grid-cols-3">
        <Section title="Competitiveness">
          <p className="text-sm text-ink">{sentence(f.competitiveness.level)}</p>
          <p className="mt-1 text-[13px] text-graphite">{f.competitiveness.reasoning}</p>
        </Section>
        <Section title="Effort to apply well">
          <p className="text-sm text-ink">About {minutes(f.effortMinutes)}</p>
          <p className="mt-1 text-[13px] text-graphite">{f.effort.notes}</p>
        </Section>
        <Section title="Roles you may fit better">
          <Bullets items={f.alternativeRoles.map((a) => <span key={a.title}><span className="text-ink">{a.title}.</span> {a.reason}</span>)} empty="None suggested." />
        </Section>
      </div>
    </div>
  );
}
