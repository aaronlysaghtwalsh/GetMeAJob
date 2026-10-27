import { useEffect, useMemo, useState } from 'react';
import { LuDownload, LuPencil, LuX, LuTrash2 } from 'react-icons/lu';
import { api } from '../../../lib/api';
import { useQuery } from '../../../lib/query';
import { useAction } from '../../../lib/actions';
import type { ArtifactDTO, ResumeContent, ResumeDoc, ResumeDraft, WorkspaceData } from '../../../lib/types';
import { Button, Panel, Textarea } from '../../../components/ui/primitives';
import { Menu } from '../../../components/ui/overlays';
import { EvidenceMarker, useBrainIndex, type BrainIndex } from '../../../components/domain/evidence';
import { ApproveButton, DiffView, FeedbackWidget, IntegrityPanel, StatusPill, VersionList } from '../../../components/domain/work';
import { ScoreBar } from '../../../components/domain/provenance';
import { cn } from '../../../components/ui/cn';
import { NotYet, RegenerateButton, Section, refreshKeys } from './shared';

export function ResumePaper({ doc, index, showMarkers = true }: { doc: ResumeDoc; index: BrainIndex; showMarkers?: boolean }) {
  return (
    <div className="doc-page mx-auto w-full max-w-[816px] rounded-[3px] bg-white px-[6%] py-[5.5%] text-[13px] leading-[1.42] shadow-[0_1px_3px_rgba(24,33,47,0.08),0_12px_40px_-16px_rgba(24,33,47,0.22)] ring-1 ring-rule">
      <div className="text-[24px] font-bold tracking-[-0.01em] text-[#111827]">{doc.header.name}</div>
      <div className="mt-0.5 text-[12px] text-[#4b5563]">{doc.header.contact.join('  |  ')}</div>
      {doc.sections.map((s) => (
        <section key={s.key} className="mt-4">
          <h4 className="border-b border-[#9ca3af] pb-0.5 text-[14px] font-bold text-[#1f2937]">{s.title}</h4>
          <div className="mt-1.5 flex flex-col gap-2">
            {s.items.map((it, i) => {
              if (it.type === 'text')
                return (
                  <p key={i}>
                    {it.text}
                    {showMarkers && <EvidenceMarker ids={it.evidenceIds} index={index} />}
                  </p>
                );
              if (it.type === 'skills')
                return (
                  <div key={i} className="flex flex-col gap-0.5">
                    {it.groups.map((g) => (
                      <p key={g.label}>
                        <b>{g.label}:</b> {g.items.join(', ')}
                      </p>
                    ))}
                  </div>
                );
              return (
                <div key={i}>
                  <div className="flex justify-between gap-4">
                    <b>{it.heading}</b>
                    <span className="shrink-0 text-[#4b5563]">{it.location}</span>
                  </div>
                  {(it.subheading || it.dates) && (
                    <div className="flex justify-between gap-4">
                      <i>{it.subheading}</i>
                      <span className="shrink-0 text-[#4b5563]">{it.dates}</span>
                    </div>
                  )}
                  {it.bullets.length > 0 && (
                    <ul className="mt-0.5 flex list-disc flex-col gap-0.5 pl-[18px] marker:text-[#374151]">
                      {it.bullets.map((b, j) => (
                        <li key={j}>
                          {b.text}
                          {showMarkers && <EvidenceMarker ids={b.evidenceIds} index={index} />}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function BulletEditor({ bullets, onChange }: { bullets: { text: string; evidenceIds: string[] }[]; onChange: (b: { text: string; evidenceIds: string[] }[]) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      {bullets.map((b, i) => (
        <div key={i} className="flex items-start gap-1.5">
          <span className="mt-2.5 text-mist">•</span>
          <Textarea className="min-h-0 py-1.5 font-doc text-[13px]" rows={2} value={b.text} onChange={(e) => onChange(bullets.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
          <button type="button" aria-label="Remove line" className="mt-1.5 rounded p-1 text-graphite hover:text-brick" onClick={() => onChange(bullets.filter((_, j) => j !== i))}>
            <LuTrash2 className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

function ResumeEditor({ draft, doc, onCancel, onSave, saving }: { draft: ResumeDraft; doc: ResumeDoc; onCancel: () => void; onSave: (d: ResumeDraft) => void; saving: boolean }) {
  const [d, setD] = useState<ResumeDraft>(() => structuredClone(draft));
  const label = (subjectId: string) => {
    for (const s of doc.sections) for (const it of s.items) if (it.type === 'entry' && it.subjectId === subjectId) return `${it.subheading || it.heading}, ${it.heading}`;
    return 'Entry';
  };
  return (
    <div className="rounded-panel border border-cobalt/30 bg-surface px-6 py-5">
      <p className="mb-4 text-[13px] text-graphite">
        Edit wording, remove lines or skills. Names, titles and dates come from your Career Brain. Every change is checked against your evidence when you save, and a new version is created.
      </p>
      <div className="flex flex-col gap-6">
        <div>
          <div className="mb-1.5 text-[13px] font-medium text-ink">Summary</div>
          <Textarea className="font-doc text-[13px]" rows={3} value={d.summary.text} onChange={(e) => setD({ ...d, summary: { ...d.summary, text: e.target.value } })} />
        </div>
        {d.experience.map((e, i) => (
          <div key={e.experienceId}>
            <div className="mb-1.5 text-[13px] font-medium text-ink">{label(e.experienceId)}</div>
            <BulletEditor bullets={e.bullets} onChange={(b) => setD({ ...d, experience: d.experience.map((x, j) => (j === i ? { ...x, bullets: b } : x)) })} />
          </div>
        ))}
        {d.projects.map((p, i) => (
          <div key={p.projectId}>
            <div className="mb-1.5 text-[13px] font-medium text-ink">{label(p.projectId)}</div>
            <BulletEditor bullets={p.bullets} onChange={(b) => setD({ ...d, projects: d.projects.map((x, j) => (j === i ? { ...x, bullets: b } : x)) })} />
          </div>
        ))}
        {d.education.map((ed, i) => (
          <div key={ed.educationId}>
            <div className="mb-1.5 text-[13px] font-medium text-ink">{label(ed.educationId)}</div>
            <BulletEditor bullets={ed.details} onChange={(b) => setD({ ...d, education: d.education.map((x, j) => (j === i ? { ...x, details: b } : x)) })} />
          </div>
        ))}
        {d.leadership.entries.map((e, i) => (
          <div key={e.experienceId}>
            <div className="mb-1.5 text-[13px] font-medium text-ink">{label(e.experienceId)}</div>
            <BulletEditor bullets={e.bullets} onChange={(b) => setD({ ...d, leadership: { ...d.leadership, entries: d.leadership.entries.map((x, j) => (j === i ? { ...x, bullets: b } : x)) } })} />
          </div>
        ))}
        <div>
          <div className="mb-1.5 text-[13px] font-medium text-ink">Skills</div>
          {d.skills.map((g, i) => (
            <div key={g.label} className="mb-2 flex flex-wrap items-center gap-1.5">
              <span className="w-36 shrink-0 text-[13px] text-graphite">{g.label}</span>
              {g.items.map((it) => (
                <span key={it} className="inline-flex items-center gap-1 rounded-full bg-ink/[0.06] py-0.5 pr-1 pl-2.5 text-[12.5px]">
                  {it}
                  <button type="button" aria-label={`Remove ${it}`} className="rounded-full p-0.5 text-graphite hover:text-brick" onClick={() => setD({ ...d, skills: d.skills.map((x, j) => (j === i ? { ...x, items: x.items.filter((y) => y !== it) } : x)) })}>
                    <LuX className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-6 flex justify-end gap-2 border-t border-rule pt-4">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" loading={saving} onClick={() => onSave(d)}>
          Save as new version
        </Button>
      </div>
    </div>
  );
}

const BASE_DECISION_LABEL: Record<string, string> = {
  use_existing: 'Based on one of your resumes',
  combine: 'Combined from your resumes',
  rebuild: 'Rebuilt from your Career Brain',
};

export function ResumeTab({ data, busy }: { data: WorkspaceData; busy: boolean }) {
  const index = useBrainIndex();
  const id = data.application.id;
  const versions = data.versions.resume;
  const latest = data.artifacts.resume;
  const [selected, setSelected] = useState<string | null>(latest?.id ?? null);
  const [compare, setCompare] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const { run, busy: acting } = useAction();
  useEffect(() => {
    setSelected(latest?.id ?? null);
    setCompare(null);
  }, [latest?.id]);
  const selectedQuery = useQuery<ArtifactDTO<ResumeContent>>(selected && selected !== latest?.id ? `/api/artifacts/${selected}` : null);
  const compareQuery = useQuery<ArtifactDTO<ResumeContent>>(compare ? `/api/artifacts/${compare}` : null);
  const art = selected === latest?.id ? latest : selectedQuery.data;
  const keywords = useMemo(() => art?.content.ats.keywords ?? [], [art]);

  if (!latest) {
    return (
      <NotYet title="No resume yet" appId={id} step="resume" canRun={!busy && !!data.artifacts.strategy}>
        The resume is written from the application strategy and your evidence, then checked line by line and parsed back to confirm ATS compatibility.
      </NotYet>
    );
  }
  if (!art) return null;
  const c = art.content;
  const blockers = c.integrity.issues.filter((i) => i.severity === 'blocker').length;
  const isLatest = art.id === latest.id;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-[13px] text-graphite">
            Version {art.version}
            {!isLatest && <span className="ml-2 text-ochre">Older version</span>}
            {compare && compareQuery.data && <span className="ml-2 text-cobalt">Comparing with version {compareQuery.data.version}</span>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!editing && isLatest && (
              <Button size="sm" icon={<LuPencil className="size-3.5" />} onClick={() => setEditing(true)} disabled={busy}>
                Edit
              </Button>
            )}
            <Menu
              button={
                <Button size="sm" icon={<LuDownload className="size-3.5" />}>
                  Download
                </Button>
              }
              items={[
                { label: 'Word (.docx), best for ATS', onSelect: () => window.open(`/api/artifacts/${art.id}/download?format=docx`, '_blank') },
                { label: 'PDF', onSelect: () => window.open(`/api/artifacts/${art.id}/download?format=pdf`, '_blank') },
                { label: 'Plain text', onSelect: () => window.open(`/api/artifacts/${art.id}/download?format=txt`, '_blank') },
              ]}
            />
            <ApproveButton artifactId={art.id} status={art.status} blockers={blockers} refresh={`/api/applications/${id}`} />
          </div>
        </div>
        {editing ? (
          <ResumeEditor
            draft={c.draft}
            doc={c.doc}
            saving={acting === 'save'}
            onCancel={() => setEditing(false)}
            onSave={async (d) => {
              const r = await run('save', () => api.post(`/api/artifacts/${art.id}/revise`, { resume: d, summary: 'Edited by you' }), { refresh: refreshKeys(id), success: 'Saved as a new version.' });
              if (r) setEditing(false);
            }}
          />
        ) : compare && compareQuery.data ? (
          <div className="rounded-panel border border-rule bg-surface px-6 py-5">
            <DiffView before={compareQuery.data.content.plainText} after={c.plainText} />
          </div>
        ) : (
          <ResumePaper doc={c.doc} index={index} />
        )}
        {!editing && !(compare && compareQuery.data) && (
          <p className="mt-3 text-center text-[12px] text-mist">The numbered markers show the evidence behind each line. They are not part of the exported file.</p>
        )}
      </div>

      <aside className="flex flex-col gap-5">
        <Panel title="Integrity">
          <IntegrityPanel report={c.integrity} />
        </Panel>
        <Panel title={`ATS compatibility: ${c.ats.score}/100`} description="Measured on the exported files, not guessed.">
          <ul className="flex flex-col gap-2.5">
            {c.ats.checks.map((ch) => (
              <li key={ch.key} className="flex gap-2 text-[13px]">
                <span className="mt-0.5">
                  <StatusPill status={ch.status} />
                </span>
                <span>
                  <span className="text-ink">{ch.label}</span>
                  <span className="block text-[12.5px] leading-snug text-graphite">{ch.detail}</span>
                </span>
              </li>
            ))}
          </ul>
          {keywords.length > 0 && (
            <div className="mt-4 border-t border-rule pt-3">
              <div className="mb-1.5 text-[12.5px] text-graphite">Job keywords</div>
              <div className="flex flex-wrap gap-1">
                {keywords.map((k) => (
                  <span
                    key={k.term}
                    title={k.found ? 'In your resume' : k.supported ? 'Supported by your evidence but missing' : 'Not supported by your evidence; deliberately left out'}
                    className={cn(
                      'rounded-full px-2 py-0.5 text-[12px]',
                      k.found ? 'bg-jade-tint text-jade-strong' : k.supported ? 'bg-ochre-tint text-ochre' : 'bg-ink/[0.05] text-mist line-through',
                    )}
                  >
                    {k.term}
                  </span>
                ))}
              </div>
              <p className="mt-2 text-[11.5px] text-mist">Green: covered. Amber: you have evidence but it is missing. Struck through: no evidence, so not added.</p>
            </div>
          )}
        </Panel>
        <Panel title={`Recruiter appeal: ${c.ats.appeal.score}/100`}>
          <div className="flex flex-col gap-2">
            {c.ats.appeal.signals.map((s) => (
              <div key={s.label} className="flex items-center justify-between gap-3 text-[13px]">
                <span className="text-ink-soft">{s.label}</span>
                <span className="inline-flex items-center gap-1.5 text-graphite tabular">
                  {s.value} <StatusPill status={s.status} />
                </span>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Why it looks like this">
          <p className="text-[13px] text-graphite">
            <span className="text-ink">{BASE_DECISION_LABEL[c.baseDecision.decision] ?? 'Built from your evidence'}.</span> {c.baseDecision.rationale}
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            {c.draft.changeLog.map((ch, i) => (
              <li key={i} className="text-[13px]">
                <span className="text-ink">{ch.change}.</span> <span className="text-graphite">{ch.reason}</span>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Versions" actions={<RegenerateButton appId={id} step="resume" disabled={busy} variant="ghost" />}>
          <VersionList versions={versions} selectedId={art.id} onSelect={(v) => setSelected(v)} compareId={compare}
            onCompare={(v) => {
              setCompare(v);
              // The comparison replaces the document preview at the top of the page.
              if (v) window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          />
        </Panel>
        <Section title="Feedback">
          <FeedbackWidget artifactId={art.id} />
        </Section>
      </aside>
    </div>
  );
}
