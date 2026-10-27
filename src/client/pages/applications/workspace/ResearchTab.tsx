import { useMemo, useState } from 'react';
import { LuExternalLink, LuGlobe } from 'react-icons/lu';
import type { WorkspaceData, ResearchContent } from '../../../lib/types';
import { sentence } from '../../../lib/format';
import { RESEARCH_DEPTH_LABEL } from '../../../../shared/constants';
import { Badge, Callout, Panel } from '../../../components/ui/primitives';
import { HoverCard, SegmentedControl } from '../../../components/ui/overlays';
import { cn } from '../../../components/ui/cn';
import { Bullets, NotYet, RegenerateButton, Section } from './shared';

const TYPE_STYLE = {
  fact: { label: 'Fact', cls: 'bg-jade-tint text-jade-strong' },
  interpretation: { label: 'Interpretation', cls: 'bg-cobalt-tint text-cobalt' },
  hypothesis: { label: 'Hypothesis', cls: 'bg-ochre-tint text-ochre' },
} as const;

function SourceRefs({ ids, research }: { ids: string[]; research: ResearchContent }) {
  return (
    <span className="inline-flex flex-wrap gap-1 align-middle">
      {ids.map((sid) => {
        const s = research.sources.find((x) => x.id === sid);
        if (!s) return null;
        return (
          <HoverCard
            key={sid}
            placement="top"
            trigger={
              <a
                href={s.url || undefined}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex h-[18px] items-center rounded border border-rule-strong bg-surface px-1 font-sans text-[11px] font-medium text-graphite hover:border-cobalt hover:text-cobalt"
              >
                {sid}
              </a>
            }
          >
            <div className="w-72">
              <div className="font-medium text-ink">{s.title}</div>
              {s.url && <div className="truncate text-[12px] text-cobalt">{s.url}</div>}
              {s.snippet && <div className="mt-1.5 text-[12.5px] text-graphite italic">“{s.snippet}”</div>}
            </div>
          </HoverCard>
        );
      })}
    </span>
  );
}

export function ResearchTab({ data, busy }: { data: WorkspaceData; busy: boolean }) {
  const art = data.artifacts.research;
  const [filter, setFilter] = useState<'all' | 'fact' | 'interpretation' | 'hypothesis'>('all');
  const id = data.application.id;
  const grouped = useMemo(() => {
    const m = new Map<string, ResearchContent['findings']>();
    for (const f of art?.content.findings ?? []) {
      if (filter !== 'all' && f.type !== filter) continue;
      m.set(f.category, [...(m.get(f.category) ?? []), f]);
    }
    return [...m.entries()];
  }, [art, filter]);
  if (!art) {
    return (
      <NotYet title="No company research yet" appId={id} step="research" canRun={!busy && !!data.job.intelligence}>
        Research uses web search with citations. Every finding is labelled as fact, interpretation or hypothesis.
      </NotYet>
    );
  }
  const r = art.content;
  const counts = { fact: r.findings.filter((f) => f.type === 'fact').length, interpretation: r.findings.filter((f) => f.type === 'interpretation').length, hypothesis: r.findings.filter((f) => f.type === 'hypothesis').length };
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-w-0 flex-col gap-6">
        {!r.webSearchUsed && (
          <Callout tone="ochre" icon={<LuGlobe />} title="Research was limited to the job posting">
            Your AI provider does not offer web search, so only the posting{r.sources.length > 1 ? ' and the company website' : ''} could be used.
          </Callout>
        )}
        <Panel
          title={`What ${data.job.intelligence?.company || 'the company'} does`}
          description={`${RESEARCH_DEPTH_LABEL[r.depth]} research, version ${art.version}, ${r.sources.length} sources${r.searches.length ? `, ${r.searches.length} searches` : ''}`}
          actions={<RegenerateButton appId={id} step="research" label="Research again" disabled={busy} />}
        >
          <p className="text-[15px] leading-relaxed text-ink">{r.overview}</p>
        </Panel>

        <section>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-[15px] font-semibold text-ink">Findings</h3>
            <SegmentedControl
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: `All (${r.findings.length})` },
                { value: 'fact', label: `Facts (${counts.fact})` },
                { value: 'interpretation', label: `Interpretations (${counts.interpretation})` },
                { value: 'hypothesis', label: `Hypotheses (${counts.hypothesis})` },
              ]}
            />
          </div>
          <div className="flex flex-col gap-4">
            {grouped.map(([cat, list]) => (
              <div key={cat} className="rounded-panel border border-rule bg-surface px-5 py-4">
                <div className="mb-2.5 text-[13px] font-medium text-graphite">{sentence(cat)}</div>
                <ul className="flex flex-col gap-3">
                  {list.map((f) => (
                    <li key={f.id} className="flex gap-3">
                      <span className={cn('mt-0.5 h-fit shrink-0 rounded px-1.5 py-px text-[11px] font-medium', TYPE_STYLE[f.type].cls)}>{TYPE_STYLE[f.type].label}</span>
                      <span className="min-w-0 text-sm leading-relaxed text-ink">
                        {f.claim} {f.date && <span className="text-[12px] text-mist">({f.date})</span>} <SourceRefs ids={f.sourceIds} research={r} />
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {!grouped.length && <p className="text-[13px] text-mist">No findings in this filter.</p>}
          </div>
          {r.integrity.downgraded.length > 0 && (
            <p className="mt-3 text-[12.5px] text-graphite">
              {r.integrity.downgraded.length} claim{r.integrity.downgraded.length === 1 ? ' was' : 's were'} downgraded to hypothesis because no source supported {r.integrity.downgraded.length === 1 ? 'it' : 'them'}.
            </p>
          )}
        </section>
      </div>

      <aside className="flex flex-col gap-6">
        <Section title="What they appear to value">
          <Bullets items={r.values.map((v) => <span key={v.value}>{v.value}</span>)} />
        </Section>
        <Section title="Team signals">
          <Bullets items={r.teamSignals.map((v) => <span key={v.signal}>{v.signal}</span>)} />
        </Section>
        <Section title="Specific things you could mention">
          <Bullets items={r.talkingPoints.map((v) => <span key={v.point}>{v.point}</span>)} />
        </Section>
        <Section title="Still unknown">
          <Bullets items={r.openQuestions} empty="Nothing flagged." />
        </Section>
        <Section title="Sources">
          <ol className="flex flex-col gap-2">
            {r.sources.map((s) => (
              <li key={s.id} className="flex gap-2 text-[12.5px]">
                <Badge className="h-fit shrink-0">{s.id}</Badge>
                <span className="min-w-0">
                  {s.url ? (
                    <a href={s.url} target="_blank" rel="noreferrer noopener" className="text-ink hover:text-cobalt hover:underline">
                      {s.title} <LuExternalLink className="inline size-3" />
                    </a>
                  ) : (
                    <span className="text-ink">{s.title}</span>
                  )}
                </span>
              </li>
            ))}
          </ol>
        </Section>
      </aside>
    </div>
  );
}
