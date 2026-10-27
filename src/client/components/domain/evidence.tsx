import { useMemo, type ReactNode } from 'react';
import { LuFileText, LuMessageSquare, LuPencil, LuQuote } from 'react-icons/lu';
import { useQuery } from '../../lib/query';
import type { CareerBrainDTO, DocumentDTO, EvidenceDTO } from '../../lib/types';
import { HoverCard } from '../ui/overlays';
import { ProvenanceBadge, ProvenanceDot } from './provenance';
import { cn } from '../ui/cn';
import { THEME_LABEL, type Theme } from '../../../shared/constants';

export interface BrainIndex {
  evidence: Map<string, EvidenceDTO>;
  records: Map<string, { kind: 'experience' | 'education' | 'project'; label: string; sub: string }>;
  documents: Map<string, DocumentDTO>;
  ready: boolean;
}

/** Index of the Career Brain for resolving evidence ids shown next to generated content. */
export function useBrainIndex(): BrainIndex {
  const { data } = useQuery<{ brain: CareerBrainDTO }>('/api/brain');
  const docs = useQuery<{ documents: DocumentDTO[] }>('/api/documents');
  return useMemo(() => {
    const evidence = new Map<string, EvidenceDTO>();
    const records: BrainIndex['records'] = new Map();
    const documents = new Map<string, DocumentDTO>();
    if (data) {
      for (const e of data.brain.evidence) evidence.set(e.id, e);
      for (const x of data.brain.experiences) records.set(x.id, { kind: 'experience', label: `${x.title}, ${x.organization}`, sub: [x.startDate, x.isCurrent ? 'present' : x.endDate].filter(Boolean).join(' to ') });
      for (const d of data.brain.education) records.set(d.id, { kind: 'education', label: [d.degree, d.field].filter(Boolean).join(', ') || d.institution, sub: d.institution });
      for (const p of data.brain.projects) records.set(p.id, { kind: 'project', label: p.name, sub: p.context });
    }
    for (const d of docs.data?.documents ?? []) documents.set(d.id, d);
    return { evidence, records, documents, ready: !!data };
  }, [data, docs.data]);
}

export function EvidenceSourceLine({ e, index }: { e: EvidenceDTO; index: BrainIndex }) {
  const doc = e.sources.find((s) => s.type === 'document');
  const answer = e.sources.find((s) => s.type === 'answer');
  const manual = e.sources.find((s) => s.type === 'manual');
  if (doc && doc.type === 'document') {
    const d = index.documents.get(doc.documentId);
    return (
      <div className="mt-2 rounded border-l-2 border-jade/40 bg-paper px-2.5 py-1.5 text-[12.5px] text-ink-soft">
        <div className="mb-0.5 flex items-center gap-1 text-[11.5px] text-graphite">
          <LuFileText className="size-3" />
          {d ? d.label : 'Uploaded document'}
          {!doc.verified && <span className="text-ochre">(quote not found in original)</span>}
        </div>
        <span className="italic">“{doc.quote}”</span>
      </div>
    );
  }
  if (answer && answer.type === 'answer') {
    return (
      <div className="mt-2 rounded border-l-2 border-cobalt/40 bg-paper px-2.5 py-1.5 text-[12.5px] text-ink-soft">
        <div className="mb-0.5 flex items-center gap-1 text-[11.5px] text-graphite">
          <LuMessageSquare className="size-3" /> Your answer
        </div>
        <span className="italic">“{answer.excerpt}”</span>
      </div>
    );
  }
  if (manual) {
    return (
      <div className="mt-2 flex items-center gap-1 text-[12px] text-graphite">
        <LuPencil className="size-3" /> Entered by you
      </div>
    );
  }
  return null;
}

/** Hover content explaining exactly what supports a claim. */
export function EvidenceCardList({ ids, index }: { ids: string[]; index: BrainIndex }) {
  if (!ids.length) return <div className="text-graphite">No evidence cited.</div>;
  return (
    <div className="flex max-h-80 w-80 flex-col gap-3 overflow-y-auto">
      {ids.map((id) => {
        const e = index.evidence.get(id);
        const r = index.records.get(id);
        if (e) {
          return (
            <div key={id}>
              <div className="flex items-start justify-between gap-2">
                <span className="text-[13px] leading-snug text-ink">{e.statement}</span>
              </div>
              <div className="mt-1.5">
                <ProvenanceBadge value={e.provenance} />
              </div>
              <EvidenceSourceLine e={e} index={index} />
            </div>
          );
        }
        if (r) {
          return (
            <div key={id} className="text-[13px]">
              <div className="text-ink">{r.label}</div>
              <div className="text-graphite">{r.sub || r.kind}</div>
            </div>
          );
        }
        return (
          <div key={id} className="text-[12.5px] text-brick">
            Missing evidence ({id})
          </div>
        );
      })}
    </div>
  );
}

/** Small marker after a generated line: hover to see the evidence behind it. */
export function EvidenceMarker({ ids, index, className }: { ids: string[]; index: BrainIndex; className?: string }) {
  const provs = ids.map((id) => index.evidence.get(id)?.provenance).filter(Boolean);
  const weakest = provs.includes('unsupported') ? 'unsupported' : provs.includes('inferred') ? 'inferred' : provs.includes('applicant_provided') ? 'applicant_provided' : 'verified';
  const tone = !ids.length ? 'border-brick/40 text-brick' : weakest === 'verified' ? 'border-jade/30 text-jade-strong' : weakest === 'applicant_provided' ? 'border-cobalt/30 text-cobalt' : 'border-ochre/40 text-ochre';
  return (
    <HoverCard
      placement="right"
      trigger={
        <button
          type="button"
          className={cn(
            'no-print ml-1 inline-flex h-[17px] min-w-[17px] translate-y-[-1px] items-center justify-center rounded-full border bg-surface px-1 align-middle font-sans text-[10.5px] leading-none font-semibold',
            tone,
            className,
          )}
          aria-label={`${ids.length} evidence item${ids.length === 1 ? '' : 's'}`}
        >
          {ids.length || '!'}
        </button>
      }
    >
      <EvidenceCardList ids={ids} index={index} />
    </HoverCard>
  );
}

export function EvidenceInline({ e, index, actions, compact }: { e: EvidenceDTO; index?: BrainIndex; actions?: ReactNode; compact?: boolean }) {
  return (
    <div className={cn('group flex items-start gap-3', e.hidden && 'opacity-50')}>
      <ProvenanceDot value={e.provenance} className="mt-[7px]" />
      <div className="min-w-0 flex-1">
        <p className={cn('leading-relaxed text-ink', compact ? 'text-[13px]' : 'text-sm')}>{e.statement}</p>
        {(e.metrics.length > 0 || e.themes.length > 0) && (
          <div className="mt-1 flex flex-wrap gap-1.5">
            {e.metrics.map((m, i) => (
              <span key={i} className="rounded bg-jade-tint/60 px-1.5 py-px text-[11.5px] font-medium text-jade-strong tabular">
                {m.value} {m.unit}
              </span>
            ))}
            {!compact &&
              e.themes.slice(0, 4).map((t) => (
                <span key={t} className="rounded bg-ink/[0.05] px-1.5 py-px text-[11.5px] text-graphite">
                  {(THEME_LABEL[t as Theme] ?? t.replace(/_/g, ' ')).toLowerCase()}
                </span>
              ))}
          </div>
        )}
      </div>
      {index && (
        <HoverCard
          placement="left"
          trigger={
            <span className="mt-0.5 inline-flex shrink-0 cursor-default items-center text-mist hover:text-graphite" aria-label="Source">
              <LuQuote className="size-3.5" />
            </span>
          }
        >
          <div className="w-72">
            <ProvenanceBadge value={e.provenance} />
            <EvidenceSourceLine e={e} index={index} />
          </div>
        </HoverCard>
      )}
      {actions && <div className="flex shrink-0 items-center gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">{actions}</div>}
    </div>
  );
}
