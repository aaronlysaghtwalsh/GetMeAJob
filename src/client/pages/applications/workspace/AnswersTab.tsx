import { useState } from 'react';
import { LuPlus, LuShieldAlert, LuTrash2, LuPencil, LuRefreshCw, LuCircleHelp, LuEllipsis } from 'react-icons/lu';
import { api } from '../../../lib/api';
import { useAction } from '../../../lib/actions';
import type { WorkspaceData } from '../../../lib/types';
import { charCount, wordCount } from '../../../../shared/text';
import { Badge, Button, Callout, EmptyState, Field, Textarea } from '../../../components/ui/primitives';
import { Dialog, HoverCard, Menu } from '../../../components/ui/overlays';
import { EvidenceMarker, useBrainIndex } from '../../../components/domain/evidence';
import { ApproveButton, IntegrityPanel } from '../../../components/domain/work';
import { cn } from '../../../components/ui/cn';
import { refreshKeys } from './shared';

type Q = WorkspaceData['questions'][number];

function LimitMeter({ text, q }: { text: string; q: Q }) {
  if (q.limitType === 'none' || !q.limitValue) return <span className="text-[12px] text-mist tabular">{wordCount(text)} words</span>;
  const n = q.limitType === 'chars' ? charCount(text) : wordCount(text);
  const over = n > q.limitValue;
  return (
    <span className={cn('text-[12px] tabular', over ? 'font-medium text-brick' : 'text-graphite')}>
      {n} / {q.limitValue} {q.limitType === 'chars' ? 'characters' : 'words'}
    </span>
  );
}

function AnswerCard({ q, n, data, busy }: { q: Q; n: number; data: WorkspaceData; busy: boolean }) {
  const index = useBrainIndex();
  const { run, busy: acting } = useAction();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [guidanceOpen, setGuidanceOpen] = useState(false);
  const [guidance, setGuidance] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const id = data.application.id;
  const a = q.answer;
  const blockers = a?.content.integrity.issues.filter((i) => i.severity === 'blocker').length ?? 0;
  return (
    <article className="rounded-panel border border-rule bg-surface">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-rule px-5 py-3.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 text-[12px] font-medium text-mist tabular">Q{n}</span>
            <h3 className="text-[15px] leading-snug font-medium text-ink">{q.question}</h3>
          </div>
          <div className="mt-1.5 ml-8 flex flex-wrap gap-1.5">
            {q.sensitive && (
              <Badge tone="ochre">
                <LuShieldAlert className="size-3" /> Sensitive, review yourself
              </Badge>
            )}
            {q.limitType !== 'none' && q.limitValue && (
              <Badge>
                Limit {q.limitValue} {q.limitType === 'chars' ? 'characters' : 'words'}
              </Badge>
            )}
            {!q.required && <Badge>Optional</Badge>}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {a && (
            <ApproveButton
              artifactId={a.id}
              status={a.status}
              blockers={blockers}
              refresh={`/api/applications/${id}`}
              sensitive={q.sensitive ? { question: q.question, answer: a.content.draft.answer } : undefined}
            />
          )}
          <Menu
            button={
              <button type="button" aria-label="Question actions" className="flex size-8 items-center justify-center rounded-control text-graphite hover:bg-ink/5 hover:text-ink">
                <LuEllipsis className="size-4" />
              </button>
            }
            items={[{ label: 'Remove question', icon: <LuTrash2 />, danger: true, onSelect: () => setConfirmRemove(true) }]}
          />
        </div>
      </header>
      <div className="px-5 py-4">
        {!a ? (
          <div className="flex items-center justify-between gap-3">
            <p className="text-[13px] text-graphite">Not answered yet.</p>
            <Button size="sm" variant="primary" disabled={busy} loading={acting === 'gen'} onClick={() => void run('gen', () => api.post(`/api/applications/${id}/questions/${q.id}/answer`, {}), { refresh: refreshKeys(id) })}>
              Draft answer
            </Button>
          </div>
        ) : editing ? (
          <div>
            <Textarea rows={7} value={text} onChange={(e) => setText(e.target.value)} />
            <div className="mt-2 flex items-center justify-between gap-3">
              <LimitMeter text={text} q={q} />
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  loading={acting === 'save'}
                  onClick={async () => {
                    const r = await run('save', () => api.post(`/api/artifacts/${a.id}/revise`, { answer: text, summary: 'Edited by you' }), { refresh: refreshKeys(id), success: 'Saved as a new version.' });
                    if (r) setEditing(false);
                  }}
                >
                  Save as new version
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div>
            {a.content.draft.needsApplicantInput && (
              <Callout tone="ochre" className="mb-3" icon={<LuCircleHelp />} title="Needs your input">
                {a.content.draft.needsApplicantInput}
              </Callout>
            )}
            {a.content.draft.answer ? (
              <p className="text-[14.5px] leading-relaxed whitespace-pre-wrap text-ink">
                {a.content.draft.answer}
                {a.content.draft.evidenceIds.length > 0 && <EvidenceMarker ids={a.content.draft.evidenceIds} index={index} />}
              </p>
            ) : (
              <p className="text-[13px] text-graphite italic">No draft: answer this one yourself.</p>
            )}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <LimitMeter text={a.content.draft.answer} q={q} />
                <span className="text-[12px] text-mist">Version {a.version}</span>
              </div>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<LuPencil className="size-3.5" />}
                  onClick={() => {
                    setText(a.content.draft.answer);
                    setEditing(true);
                  }}
                >
                  Edit
                </Button>
                <Button size="sm" variant="ghost" icon={<LuRefreshCw className="size-3.5" />} disabled={busy} onClick={() => setGuidanceOpen(true)}>
                  Regenerate
                </Button>
                <HoverCard
                  placement="left"
                  trigger={
                    <span className="inline-flex h-8 cursor-default items-center px-2 text-[13px] text-graphite hover:text-ink">Why this answer</span>
                  }
                >
                  <div className="w-80 text-[13px]">
                    <div className="font-medium text-ink">What they are testing</div>
                    <p className="mt-0.5 text-graphite">{a.content.draft.analysis.testing}</p>
                    <div className="mt-2 font-medium text-ink">Strategy</div>
                    <p className="mt-0.5 text-graphite">{a.content.draft.strategy}</p>
                    {a.content.draft.analysis.pitfalls.length > 0 && (
                      <>
                        <div className="mt-2 font-medium text-ink">Avoids</div>
                        <p className="mt-0.5 text-graphite">{a.content.draft.analysis.pitfalls.join('; ')}</p>
                      </>
                    )}
                  </div>
                </HoverCard>
              </div>
            </div>
            {a.content.integrity.issues.length > 0 && (
              <div className="mt-4 border-t border-rule pt-3">
                <IntegrityPanel report={a.content.integrity} />
              </div>
            )}
          </div>
        )}
      </div>
      <Dialog
        open={guidanceOpen}
        onClose={() => setGuidanceOpen(false)}
        title="Regenerate answer"
        description="A new version is created; the current one is kept."
        footer={
          <>
            <Button variant="ghost" onClick={() => setGuidanceOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={acting === 'regen'}
              onClick={async () => {
                const r = await run('regen', () => api.post(`/api/applications/${id}/questions/${q.id}/answer`, { guidance: guidance || undefined }), { refresh: refreshKeys(id) });
                if (r) {
                  setGuidanceOpen(false);
                  setGuidance('');
                }
              }}
            >
              Generate new version
            </Button>
          </>
        }
      >
        <Field label="Direction" optional hint="For example: use the Fizzwell story instead; make it warmer.">
          <Textarea rows={3} value={guidance} onChange={(e) => setGuidance(e.target.value)} />
        </Field>
      </Dialog>
      <Dialog
        open={confirmRemove}
        onClose={() => setConfirmRemove(false)}
        title="Remove this question?"
        description={q.answer ? `Its ${q.versions.length === 1 ? 'drafted answer is' : `${q.versions.length} answer versions are`} removed too.` : 'It has no answer yet.'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmRemove(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={acting === 'del'}
              onClick={async () => {
                const done = await run(
                  'del',
                  async () => {
                    await api.delete(`/api/applications/${id}/questions/${q.id}`);
                    return true;
                  },
                  { refresh: refreshKeys(id), success: 'Question removed.' },
                );
                if (done) setConfirmRemove(false);
              }}
            >
              Remove question
            </Button>
          </>
        }
      >
        <p className="text-sm text-graphite">{q.question}</p>
      </Dialog>
    </article>
  );
}

export function AnswersTab({ data, busy }: { data: WorkspaceData; busy: boolean }) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');
  const { run, busy: acting } = useAction();
  const id = data.application.id;
  return (
    <div className="max-w-3xl">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-graphite">Each answer is written for what the question is really testing, stays within its limit, and stays consistent with your resume and cover letter.</p>
        <Button size="sm" icon={<LuPlus className="size-3.5" />} onClick={() => setAdding(true)}>
          Add questions
        </Button>
      </div>
      {!data.questions.length ? (
        <div className="rounded-panel border border-dashed border-rule-strong bg-surface">
          <EmptyState icon={<LuCircleHelp />} title="No application questions" action={<Button onClick={() => setAdding(true)}>Add questions</Button>}>
            Paste the questions from the application form. Word or character limits are detected automatically.
          </EmptyState>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {data.questions.map((q, i) => (
            <AnswerCard key={q.id} q={q} n={i + 1} data={data} busy={busy} />
          ))}
        </div>
      )}
      <Dialog
        open={adding}
        onClose={() => setAdding(false)}
        title="Add application questions"
        description='One per line or numbered. Limits like "(200 words)" or "500 characters" are detected.'
        footer={
          <>
            <Button variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={acting === 'add'}
              disabled={!text.trim()}
              onClick={async () => {
                const r = await run('add', () => api.post(`/api/applications/${id}/questions`, { text }), { refresh: refreshKeys(id), success: 'Questions added. Use "Draft answer" on each.' });
                if (r) {
                  setAdding(false);
                  setText('');
                }
              }}
            >
              Add questions
            </Button>
          </>
        }
      >
        <Textarea rows={7} value={text} onChange={(e) => setText(e.target.value)} placeholder={'1. Why do you want to work here? (200 words)\n2. Describe a challenge you overcame.'} autoFocus />
      </Dialog>
    </div>
  );
}
