import { useEffect, useState } from 'react';
import { LuDownload, LuPencil } from 'react-icons/lu';
import { api } from '../../../lib/api';
import { useQuery } from '../../../lib/query';
import { useAction } from '../../../lib/actions';
import type { ArtifactDTO, CareerBrainDTO, CoverLetterContent, WorkspaceData } from '../../../lib/types';
import { Button, Input, Panel, Textarea } from '../../../components/ui/primitives';
import { HoverCard, Menu } from '../../../components/ui/overlays';
import { EvidenceMarker, useBrainIndex } from '../../../components/domain/evidence';
import { ApproveButton, DiffView, FeedbackWidget, IntegrityPanel, VersionList, WritingPanel } from '../../../components/domain/work';
import { NotYet, RegenerateButton, Section, refreshKeys } from './shared';

function FindingMarker({ ids, data }: { ids: string[]; data: WorkspaceData }) {
  const research = data.artifacts.research?.content;
  if (!ids.length || !research) return null;
  return (
    <HoverCard
      placement="right"
      trigger={
        <button type="button" className="no-print ml-1 inline-flex h-[17px] translate-y-[-1px] items-center rounded-full border border-cobalt/30 bg-surface px-1.5 align-middle font-sans text-[10.5px] font-semibold text-cobalt">
          {ids.join(' ')}
        </button>
      }
    >
      <div className="flex w-80 flex-col gap-2.5">
        {ids.map((fid) => {
          const f = research.findings.find((x) => x.id === fid);
          if (!f) return null;
          return (
            <div key={fid} className="text-[13px]">
              <span className="mr-1.5 rounded bg-ink/[0.06] px-1 text-[11px] text-graphite">{f.type}</span>
              <span className="text-ink">{f.claim}</span>
              <div className="mt-0.5 text-[11.5px] text-mist">
                Sources: {f.sourceIds.map((s) => research.sources.find((x) => x.id === s)?.title ?? s).join('; ')}
              </div>
            </div>
          );
        })}
      </div>
    </HoverCard>
  );
}

export function CoverLetterTab({ data, busy }: { data: WorkspaceData; busy: boolean }) {
  const index = useBrainIndex();
  const brain = useQuery<{ brain: CareerBrainDTO }>('/api/brain');
  const id = data.application.id;
  const latest = data.artifacts.cover_letter;
  const [selected, setSelected] = useState<string | null>(latest?.id ?? null);
  const [compare, setCompare] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<{ greeting: string; paragraphs: string[]; closing: string } | null>(null);
  const { run, busy: acting } = useAction();
  useEffect(() => {
    setSelected(latest?.id ?? null);
    setCompare(null);
  }, [latest?.id]);
  const selQ = useQuery<ArtifactDTO<CoverLetterContent>>(selected && selected !== latest?.id ? `/api/artifacts/${selected}` : null);
  const cmpQ = useQuery<ArtifactDTO<CoverLetterContent>>(compare ? `/api/artifacts/${compare}` : null);
  const art = selected === latest?.id ? latest : selQ.data;

  if (!latest) {
    return (
      <NotYet title="No cover letter yet" appId={id} step="cover_letter" canRun={!busy && !!data.artifacts.strategy}>
        The letter follows the strategy’s angle, cites company research for anything it says about the employer, and gets an editorial pass to remove generic phrasing.
      </NotYet>
    );
  }
  if (!art) return null;
  const c = art.content;
  const blockers = c.integrity.issues.filter((i) => i.severity === 'blocker').length;
  const profile = brain.data?.brain.profile;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-[13px] text-graphite">
            Version {art.version}, {c.wordCount} words
            {art.id !== latest.id && <span className="ml-2 text-ochre">Older version</span>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!editing && art.id === latest.id && (
              <Button
                size="sm"
                icon={<LuPencil className="size-3.5" />}
                disabled={busy}
                onClick={() => {
                  setDraft({ greeting: c.draft.greeting, paragraphs: c.draft.paragraphs.map((p) => p.text), closing: c.draft.closing });
                  setEditing(true);
                }}
              >
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
                { label: 'Word (.docx)', onSelect: () => window.open(`/api/artifacts/${art.id}/download?format=docx`, '_blank') },
                { label: 'PDF', onSelect: () => window.open(`/api/artifacts/${art.id}/download?format=pdf`, '_blank') },
                { label: 'Plain text', onSelect: () => window.open(`/api/artifacts/${art.id}/download?format=txt`, '_blank') },
              ]}
            />
            <ApproveButton artifactId={art.id} status={art.status} blockers={blockers} refresh={`/api/applications/${id}`} />
          </div>
        </div>

        {editing && draft ? (
          <div className="rounded-panel border border-cobalt/30 bg-surface px-6 py-5">
            <div className="flex flex-col gap-3">
              <Input className="font-doc" value={draft.greeting} onChange={(e) => setDraft({ ...draft, greeting: e.target.value })} />
              {draft.paragraphs.map((p, i) => (
                <Textarea key={i} className="font-doc text-[13.5px]" rows={5} value={p} onChange={(e) => setDraft({ ...draft, paragraphs: draft.paragraphs.map((x, j) => (j === i ? e.target.value : x)) })} />
              ))}
              <Input className="font-doc" value={draft.closing} onChange={(e) => setDraft({ ...draft, closing: e.target.value })} />
            </div>
            <div className="mt-5 flex justify-end gap-2 border-t border-rule pt-4">
              <Button variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                loading={acting === 'save'}
                onClick={async () => {
                  const r = await run('save', () => api.post(`/api/artifacts/${art.id}/revise`, { coverLetter: { ...draft, paragraphs: draft.paragraphs.filter((p) => p.trim()) }, summary: 'Edited by you' }), {
                    refresh: refreshKeys(id),
                    success: 'Saved as a new version.',
                  });
                  if (r) setEditing(false);
                }}
              >
                Save as new version
              </Button>
            </div>
          </div>
        ) : compare && cmpQ.data ? (
          <div className="rounded-panel border border-rule bg-surface px-6 py-5">
            <DiffView before={cmpQ.data.content.text} after={c.text} />
          </div>
        ) : (
          <div className="doc-page mx-auto w-full max-w-[760px] rounded-[3px] bg-white px-[8%] py-[7%] text-[14px] leading-[1.6] shadow-[0_1px_3px_rgba(24,33,47,0.08),0_12px_40px_-16px_rgba(24,33,47,0.22)] ring-1 ring-rule">
            {profile && (
              <div className="mb-8">
                <div className="text-[20px] font-bold text-[#111827]">{profile.fullName}</div>
                <div className="text-[12px] text-[#4b5563]">{[profile.location, profile.phone, profile.email].filter(Boolean).join('  |  ')}</div>
              </div>
            )}
            <p className="mb-4">{c.draft.greeting}</p>
            {c.draft.paragraphs.map((p, i) => (
              <p key={i} className="mb-4">
                {p.text}
                {p.evidenceIds.length > 0 && <EvidenceMarker ids={p.evidenceIds} index={index} />}
                <FindingMarker ids={p.findingIds} data={data} />
              </p>
            ))}
            <p className="mt-6">{c.draft.closing}</p>
            <p>{profile?.fullName}</p>
          </div>
        )}
        {!editing && !(compare && cmpQ.data) && (
          <p className="mt-3 text-center text-[12px] text-mist">Numbered markers show the evidence behind a paragraph; F markers show the company research it draws on. Neither appears in the exported letter.</p>
        )}
      </div>

      <aside className="flex flex-col gap-5">
        <Panel title="Integrity">
          <IntegrityPanel report={c.integrity} />
        </Panel>
        <Panel title="Editorial check">
          <WritingPanel lint={c.writing} />
        </Panel>
        {c.draft.notes && (
          <Panel title="Approach">
            <p className="text-[13px] text-graphite">{c.draft.notes}</p>
          </Panel>
        )}
        <Panel title="Versions" actions={<RegenerateButton appId={id} step="cover_letter" disabled={busy} variant="ghost" />}>
          <VersionList versions={data.versions.cover_letter} selectedId={art.id} onSelect={setSelected} compareId={compare}
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
