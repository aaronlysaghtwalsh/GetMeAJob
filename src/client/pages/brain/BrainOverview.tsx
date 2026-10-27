import { useMemo, useState, type ReactNode } from 'react';
import { LuBadgeCheck, LuEllipsis, LuEyeOff, LuGraduationCap, LuPencil, LuPlus, LuTrash2, LuBriefcase, LuFolderKanban, LuMail, LuPhone, LuMapPin, LuLink, LuCircleX, LuCheck, LuUpload, LuLayers } from 'react-icons/lu';
import { api } from '../../lib/api';
import { useAction } from '../../lib/actions';
import { formatRange } from '../../lib/format';
import type { CareerBrainDTO, EvidenceDTO, ExperienceDTO, EducationDTO, ProjectDTO, SkillDTO } from '../../lib/types';
import { EVIDENCE_KINDS, EXPERIENCE_KINDS, EXPERIENCE_KIND_LABEL, SKILL_CATEGORIES, SKILL_CATEGORY_LABEL, THEMES, THEME_LABEL, type Provenance } from '../../../shared/constants';
import { Badge, Button, Checkbox, EmptyState, Field, Input, Select, Textarea, ToggleGroup } from '../../components/ui/primitives';
import { Dialog, Menu, SegmentedControl, TagInput } from '../../components/ui/overlays';
import { EvidenceInline, useBrainIndex } from '../../components/domain/evidence';
import { ProvenanceBadge, ProvenanceDot } from '../../components/domain/provenance';
import { cn } from '../../components/ui/cn';

const REFRESH = ['/api/brain', '/api/dashboard'];
type Filter = 'all' | 'inferred' | 'verified' | 'applicant_provided';

function SectionTitle({ icon, children, action }: { icon: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink [&>svg]:size-4 [&>svg]:text-mist">
        {icon}
        {children}
      </h2>
      {action}
    </div>
  );
}

function EvidenceList({ items, filter, onAdd }: { items: EvidenceDTO[]; filter: Filter; onAdd?: () => void }) {
  const index = useBrainIndex();
  const { run } = useAction();
  const [editing, setEditing] = useState<EvidenceDTO | null>(null);
  const visible = items.filter((e) => (filter === 'all' ? e.provenance !== 'unsupported' || !e.hidden : e.provenance === filter));
  return (
    <>
      <ul className="flex flex-col gap-3">
        {visible.map((e) => (
          <li key={e.id}>
            <EvidenceInline
              e={e}
              index={index}
              actions={
                <>
                  {e.provenance === 'inferred' && (
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-jade-strong" onClick={() => void run('confirm', () => api.post(`/api/brain/evidence/${e.id}/confirm`), { refresh: REFRESH, success: 'Confirmed.' })}>
                      <LuCheck className="size-3.5" /> Confirm
                    </Button>
                  )}
                  <Menu
                    button={
                      <button type="button" aria-label="Evidence actions" className="rounded p-1 text-graphite hover:bg-ink/5 hover:text-ink">
                        <LuEllipsis className="size-4" />
                      </button>
                    }
                    items={[
                      { label: 'Edit wording', icon: <LuPencil />, onSelect: () => setEditing(e) },
                      { label: e.hidden ? 'Use in applications' : 'Hide from applications', icon: <LuEyeOff />, onSelect: () => void run('hide', () => api.patch(`/api/brain/evidence/${e.id}`, { hidden: !e.hidden }), { refresh: REFRESH }) },
                      { label: 'Not accurate', icon: <LuCircleX />, onSelect: () => void run('reject', () => api.post(`/api/brain/evidence/${e.id}/reject`), { refresh: REFRESH, success: 'Marked as not accurate. It will never be used.' }) },
                      'divider',
                      { label: 'Delete', icon: <LuTrash2 />, danger: true, onSelect: () => void run('del', () => api.delete(`/api/brain/evidence/${e.id}`), { refresh: REFRESH }) },
                    ]}
                  />
                </>
              }
            />
          </li>
        ))}
        {!visible.length && <li className="text-[13px] text-mist">{filter === 'all' ? 'No evidence yet.' : 'Nothing in this filter.'}</li>}
      </ul>
      {onAdd && (
        <button type="button" onClick={onAdd} className="mt-3 inline-flex items-center gap-1.5 text-[13px] text-graphite hover:text-ink">
          <LuPlus className="size-3.5" /> Add evidence
        </button>
      )}
      {editing && <EditEvidenceDialog evidence={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function EditEvidenceDialog({ evidence, onClose }: { evidence: EvidenceDTO; onClose: () => void }) {
  const [statement, setStatement] = useState(evidence.statement);
  const { run, busy } = useAction();
  return (
    <Dialog
      open
      onClose={onClose}
      title="Edit evidence"
      description="Edited evidence is marked as provided by you. Keep it factual; numbers you add here can be used in applications."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={!!busy}
            onClick={async () => {
              const r = await run('save', () => api.patch(`/api/brain/evidence/${evidence.id}`, { statement }), { refresh: REFRESH, success: 'Saved.' });
              if (r) onClose();
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <Textarea value={statement} onChange={(e) => setStatement(e.target.value)} rows={4} />
    </Dialog>
  );
}

function AddEvidenceDialog({ subjectId, subjectLabel, onClose }: { subjectId: string | null; subjectLabel: string; onClose: () => void }) {
  const [statement, setStatement] = useState('');
  const [kind, setKind] = useState<string>('achievement');
  const [themes, setThemes] = useState<string[]>([]);
  const [skills, setSkills] = useState<string[]>([]);
  const { run, busy } = useAction();
  return (
    <Dialog
      open
      onClose={onClose}
      title="Add evidence"
      description={`About: ${subjectLabel}. Write what you did and what happened, with real numbers if you have them.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={!!busy}
            disabled={statement.trim().length < 3}
            onClick={async () => {
              const r = await run('add', () => api.post('/api/brain/evidence', { statement, kind, subjectId, subjectType: 'general', themes, skills }), { refresh: REFRESH, success: 'Evidence added.' });
              if (r) onClose();
            }}
          >
            Add evidence
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="What did you do?" hint="Example: Presented a pricing analysis to the regional sales team; two of the recommendations were adopted.">
          <Textarea value={statement} onChange={(e) => setStatement(e.target.value)} rows={3} autoFocus />
        </Field>
        <Field label="Type">
          <Select value={kind} onChange={(e) => setKind(e.target.value)}>
            {EVIDENCE_KINDS.map((k) => (
              <option key={k} value={k}>
                {k.charAt(0).toUpperCase() + k.slice(1)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="What does it show?" optional>
          <ToggleGroup size="sm" multiple options={THEMES.map((t) => ({ value: t, label: THEME_LABEL[t] }))} value={themes} onChange={setThemes} />
        </Field>
        <Field label="Skills or tools used" optional>
          <TagInput value={skills} onChange={setSkills} placeholder="Type and press Enter" />
        </Field>
      </div>
    </Dialog>
  );
}

function RecordDialog({ kind, record, onClose }: { kind: 'experience' | 'education' | 'project'; record: ExperienceDTO | EducationDTO | ProjectDTO | null; onClose: () => void }) {
  const [form, setForm] = useState<Record<string, any>>(() => {
    if (record) return { ...record };
    if (kind === 'experience') return { kind: 'employment', organization: '', title: '', location: '', startDate: '', endDate: '', isCurrent: false, summary: '' };
    if (kind === 'education') return { institution: '', degree: '', field: '', minor: '', location: '', startDate: '', endDate: '', grade: '', coursework: [], honors: [] };
    return { name: '', context: '', role: '', startDate: '', endDate: '', url: '', summary: '', technologies: [] };
  });
  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));
  const { run, busy } = useAction();
  const path = kind === 'experience' ? 'experiences' : kind === 'education' ? 'education' : 'projects';
  const save = async () => {
    const payload: Record<string, unknown> = {};
    const fields =
      kind === 'experience'
        ? ['kind', 'organization', 'title', 'location', 'startDate', 'endDate', 'isCurrent', 'summary']
        : kind === 'education'
          ? ['institution', 'degree', 'field', 'minor', 'location', 'startDate', 'endDate', 'grade', 'coursework', 'honors']
          : ['name', 'context', 'role', 'startDate', 'endDate', 'url', 'summary', 'technologies'];
    for (const f of fields) payload[f] = form[f];
    const r = await run('save', () => (record ? api.patch(`/api/brain/${path}/${record.id}`, payload) : api.post(`/api/brain/${path}`, payload)), { refresh: REFRESH, success: 'Saved.' });
    if (r) onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={`${record ? 'Edit' : 'Add'} ${kind}`}
      description={record ? 'Your edits are marked as provided by you and always take precedence over documents.' : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={!!busy} onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {kind === 'experience' && (
          <>
            <Field label="Job title">
              <Input value={form.title} onChange={(e) => set('title', e.target.value)} />
            </Field>
            <Field label="Organization">
              <Input value={form.organization} onChange={(e) => set('organization', e.target.value)} />
            </Field>
            <Field label="Type">
              <Select value={form.kind} onChange={(e) => set('kind', e.target.value)}>
                {EXPERIENCE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {EXPERIENCE_KIND_LABEL[k]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Location" optional>
              <Input value={form.location} onChange={(e) => set('location', e.target.value)} />
            </Field>
          </>
        )}
        {kind === 'education' && (
          <>
            <Field label="Institution" className="sm:col-span-2">
              <Input value={form.institution} onChange={(e) => set('institution', e.target.value)} />
            </Field>
            <Field label="Degree">
              <Input value={form.degree} onChange={(e) => set('degree', e.target.value)} placeholder="B.Sc." />
            </Field>
            <Field label="Field of study">
              <Input value={form.field} onChange={(e) => set('field', e.target.value)} />
            </Field>
            <Field label="Minor" optional>
              <Input value={form.minor} onChange={(e) => set('minor', e.target.value)} />
            </Field>
            <Field label="Grade / GPA" optional>
              <Input value={form.grade} onChange={(e) => set('grade', e.target.value)} />
            </Field>
            <Field label="Relevant coursework" optional className="sm:col-span-2">
              <TagInput value={form.coursework} onChange={(v) => set('coursework', v)} />
            </Field>
          </>
        )}
        {kind === 'project' && (
          <>
            <Field label="Project name">
              <Input value={form.name} onChange={(e) => set('name', e.target.value)} />
            </Field>
            <Field label="Context" optional hint="e.g. Final-year project, hackathon">
              <Input value={form.context} onChange={(e) => set('context', e.target.value)} />
            </Field>
            <Field label="Technologies" optional className="sm:col-span-2">
              <TagInput value={form.technologies} onChange={(v) => set('technologies', v)} />
            </Field>
          </>
        )}
        <Field label="Start" hint="YYYY-MM or YYYY">
          <Input value={form.startDate} onChange={(e) => set('startDate', e.target.value)} placeholder="2024-06" />
        </Field>
        <Field label="End" hint={kind === 'experience' ? 'Leave empty if current' : 'YYYY-MM or YYYY'}>
          <Input value={form.endDate} disabled={!!form.isCurrent} onChange={(e) => set('endDate', e.target.value)} placeholder="2025-08" />
        </Field>
        {kind === 'experience' && (
          <div className="sm:col-span-2">
            <Checkbox label="I currently work here" checked={!!form.isCurrent} onChange={(v) => set('isCurrent', v)} />
          </div>
        )}
        {kind !== 'education' && (
          <Field label={kind === 'experience' ? 'What the organization does / your role in a sentence' : 'Summary'} optional className="sm:col-span-2">
            <Textarea value={form.summary} onChange={(e) => set('summary', e.target.value)} rows={2} />
          </Field>
        )}
      </div>
    </Dialog>
  );
}

function ProfileCard({ brain }: { brain: CareerBrainDTO }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(brain.profile);
  const { run, busy } = useAction();
  const p = brain.profile;
  return (
    <section className="rounded-panel border border-rule bg-surface px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-display text-xl font-semibold text-ink">{p.fullName || 'Your name'}</div>
          {p.headline && <div className="mt-0.5 text-sm text-graphite">{p.headline}</div>}
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-graphite">
            {p.location && (
              <span className="inline-flex items-center gap-1.5">
                <LuMapPin className="size-3.5" />
                {p.location}
              </span>
            )}
            {p.email && (
              <span className="inline-flex items-center gap-1.5">
                <LuMail className="size-3.5" />
                {p.email}
              </span>
            )}
            {p.phone && (
              <span className="inline-flex items-center gap-1.5">
                <LuPhone className="size-3.5" />
                {p.phone}
              </span>
            )}
            {p.links.map((l) => (
              <span key={l.url} className="inline-flex items-center gap-1.5">
                <LuLink className="size-3.5" />
                {l.url.replace(/^https?:\/\/(www\.)?/, '')}
              </span>
            ))}
          </div>
        </div>
        <Button
          size="sm"
          icon={<LuPencil className="size-3.5" />}
          onClick={() => {
            setForm(brain.profile);
            setOpen(true);
          }}
        >
          Edit contact details
        </Button>
      </div>
      <p className="mt-3 text-[12.5px] text-mist">Shown at the top of every resume and cover letter.</p>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Contact details"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={!!busy}
              onClick={async () => {
                const r = await run('profile', () => api.put('/api/brain/profile', form), { refresh: REFRESH, success: 'Saved.' });
                if (r) setOpen(false);
              }}
            >
              Save
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name">
            <Input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
          </Field>
          <Field label="Location">
            <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Chicago, IL" />
          </Field>
          <Field label="Email">
            <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label="Phone">
            <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </Field>
          <Field label="Headline" optional className="sm:col-span-2">
            <Input value={form.headline} onChange={(e) => setForm({ ...form, headline: e.target.value })} />
          </Field>
          <Field label="LinkedIn or portfolio URL" optional className="sm:col-span-2">
            <Input
              value={form.links[0]?.url ?? ''}
              onChange={(e) => setForm({ ...form, links: e.target.value ? [{ label: 'Link', url: e.target.value }, ...form.links.slice(1)] : form.links.slice(1) })}
            />
          </Field>
        </div>
      </Dialog>
    </section>
  );
}

function RecordBlock({
  title,
  subtitle,
  meta,
  provenance,
  hidden,
  evidence,
  filter,
  onEdit,
  onDelete,
  onToggleHidden,
  onAddEvidence,
  sourceCount,
}: {
  title: ReactNode;
  subtitle: ReactNode;
  meta: (string | false | null | undefined)[];
  provenance: Provenance;
  hidden: boolean;
  evidence: EvidenceDTO[];
  filter: Filter;
  onEdit: () => void;
  onDelete: () => void;
  onToggleHidden: () => void;
  onAddEvidence: () => void;
  sourceCount: number;
}) {
  return (
    <article className={cn('rounded-panel border border-rule bg-surface px-5 py-4', hidden && 'opacity-60')}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
            <ProvenanceBadge value={provenance} />
            {sourceCount > 1 && (
              <Badge title="Found in more than one document">
                <LuLayers className="size-3" /> {sourceCount} sources
              </Badge>
            )}
            {hidden && <Badge tone="ochre">Hidden</Badge>}
          </div>
          <div className="mt-0.5 text-sm text-ink-soft">{subtitle}</div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[12.5px] text-graphite">
            {meta.filter(Boolean).map((m, i) => (
              <span key={i}>{m}</span>
            ))}
          </div>
        </div>
        <Menu
          button={
            <button type="button" aria-label="Actions" className="rounded p-1.5 text-graphite hover:bg-ink/5 hover:text-ink">
              <LuEllipsis className="size-4" />
            </button>
          }
          items={[
            { label: 'Edit details', icon: <LuPencil />, onSelect: onEdit },
            { label: 'Add evidence', icon: <LuPlus />, onSelect: onAddEvidence },
            { label: hidden ? 'Show in applications' : 'Hide from applications', icon: <LuEyeOff />, onSelect: onToggleHidden },
            'divider',
            { label: 'Delete', icon: <LuTrash2 />, danger: true, onSelect: onDelete },
          ]}
        />
      </header>
      <div className="mt-3.5 border-t border-rule pt-3.5">
        <EvidenceList items={evidence} filter={filter} onAdd={onAddEvidence} />
      </div>
    </article>
  );
}

function SkillsSection({ skills }: { skills: SkillDTO[] }) {
  const { run } = useAction();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<string>('technical');
  const grouped = useMemo(() => {
    const m = new Map<string, SkillDTO[]>();
    for (const s of skills.filter((x) => x.provenance !== 'unsupported')) m.set(s.category, [...(m.get(s.category) ?? []), s]);
    return [...m.entries()].sort((a, b) => SKILL_CATEGORIES.indexOf(a[0] as any) - SKILL_CATEGORIES.indexOf(b[0] as any));
  }, [skills]);
  return (
    <section>
      <SectionTitle
        icon={<LuBadgeCheck />}
        action={
          <Button size="sm" variant="ghost" icon={<LuPlus className="size-3.5" />} onClick={() => setAdding(true)}>
            Add skill
          </Button>
        }
      >
        Skills
      </SectionTitle>
      <div className="rounded-panel border border-rule bg-surface px-5 py-4">
        {grouped.length === 0 && <p className="text-[13px] text-mist">No skills yet.</p>}
        <dl className="flex flex-col gap-3.5">
          {grouped.map(([cat, list]) => (
            <div key={cat} className="grid gap-1.5 sm:grid-cols-[180px_1fr]">
              <dt className="pt-1 text-[13px] text-graphite">{SKILL_CATEGORY_LABEL[cat as keyof typeof SKILL_CATEGORY_LABEL] ?? cat}</dt>
              <dd className="flex flex-wrap gap-1.5">
                {list.map((s) => (
                  <Menu
                    key={s.id}
                    align="start"
                    button={
                      <button
                        type="button"
                        className={cn('inline-flex items-center gap-1.5 rounded-full border border-rule-strong bg-surface py-0.5 pr-2.5 pl-2 text-[13px] text-ink hover:border-mist', s.hidden && 'opacity-50 line-through')}
                      >
                        <ProvenanceDot value={s.provenance} />
                        {s.name}
                        {s.evidenceIds.length > 0 && <span className="text-[11px] text-mist tabular">{s.evidenceIds.length}</span>}
                      </button>
                    }
                    items={[
                      ...(s.provenance === 'inferred' ? [{ label: 'Confirm I have this skill', icon: <LuCheck />, onSelect: () => void run('c', () => api.patch(`/api/brain/skills/${s.id}`, { confirm: true }), { refresh: REFRESH }) }] : []),
                      { label: s.hidden ? 'Use in applications' : 'Hide from applications', icon: <LuEyeOff />, onSelect: () => void run('h', () => api.patch(`/api/brain/skills/${s.id}`, { hidden: !s.hidden }), { refresh: REFRESH }) },
                      { label: 'Delete', icon: <LuTrash2 />, danger: true, onSelect: () => void run('d', () => api.delete(`/api/brain/skills/${s.id}`), { refresh: REFRESH }) },
                    ]}
                  />
                ))}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-[12px] text-mist">The number shows how many evidence items demonstrate the skill. Resumes can only list skills that are here.</p>
      </div>
      <Dialog
        open={adding}
        onClose={() => setAdding(false)}
        title="Add a skill"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!name.trim()}
              onClick={async () => {
                const r = await run('add', () => api.post('/api/brain/skills', { name, category }), { refresh: REFRESH, success: 'Skill added.' });
                if (r) {
                  setAdding(false);
                  setName('');
                }
              }}
            >
              Add skill
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Skill">
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="e.g. Looker" />
          </Field>
          <Field label="Category">
            <Select value={category} onChange={(e) => setCategory(e.target.value)}>
              {SKILL_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {SKILL_CATEGORY_LABEL[c]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Dialog>
    </section>
  );
}

export function BrainOverview({ brain, empty, onUpload, building }: { brain: CareerBrainDTO; empty: boolean; onUpload: () => void; building: boolean }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [recordDialog, setRecordDialog] = useState<{ kind: 'experience' | 'education' | 'project'; record: any } | null>(null);
  const [addEvidence, setAddEvidence] = useState<{ subjectId: string | null; label: string } | null>(null);
  const { run } = useAction();
  const bySubject = useMemo(() => {
    const m = new Map<string, EvidenceDTO[]>();
    for (const e of brain.evidence) m.set(e.subjectId ?? 'general', [...(m.get(e.subjectId ?? 'general') ?? []), e]);
    return m;
  }, [brain.evidence]);
  const known = new Set([...brain.experiences.map((x) => x.id), ...brain.education.map((x) => x.id), ...brain.projects.map((x) => x.id)]);
  const general = brain.evidence.filter((e) => !e.subjectId || !known.has(e.subjectId));

  if (empty) {
    return (
      <div className="rounded-panel border border-dashed border-rule-strong bg-surface">
        <EmptyState
          icon={<LuUpload />}
          title={building ? 'Reading your documents…' : 'Start with your resumes'}
          action={
            !building && (
              <Button variant="primary" icon={<LuUpload className="size-4" />} onClick={onUpload}>
                Upload resumes
              </Button>
            )
          }
        >
          Upload one or several versions. GetMeAJob treats them as different views of the same person: it merges them into one profile, keeps every fact linked to where it came from, and asks you
          about anything that disagrees.
        </EmptyState>
      </div>
    );
  }

  const del = (path: string, id: string) => void run('del', () => api.delete(`/api/brain/${path}/${id}`), { refresh: REFRESH, success: 'Deleted.' });
  const toggle = (path: string, id: string, hidden: boolean) => void run('hide', () => api.patch(`/api/brain/${path}/${id}`, { hidden: !hidden }), { refresh: REFRESH });
  const s = brain.stats;

  return (
    <div className="flex flex-col gap-8">
      <ProfileCard brain={brain} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-graphite">
          <span className="font-medium text-ink tabular">{s.evidence}</span> evidence items: <span className="text-jade-strong tabular">{s.verified}</span> verified,{' '}
          <span className="text-cobalt tabular">{s.applicantProvided}</span> provided by you
          {s.inferred > 0 && (
            <>
              , <span className="text-ochre tabular">{s.inferred}</span> to confirm
            </>
          )}
          . <span className="tabular">{s.withMetrics}</span> include a measurable result.
        </p>
        <SegmentedControl<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'inferred', label: `To confirm${s.inferred ? ` (${s.inferred})` : ''}` },
            { value: 'verified', label: 'Verified' },
            { value: 'applicant_provided', label: 'Provided by you' },
          ]}
        />
      </div>

      <section>
        <SectionTitle
          icon={<LuBriefcase />}
          action={
            <Button size="sm" variant="ghost" icon={<LuPlus className="size-3.5" />} onClick={() => setRecordDialog({ kind: 'experience', record: null })}>
              Add experience
            </Button>
          }
        >
          Experience
        </SectionTitle>
        <div className="flex flex-col gap-3">
          {brain.experiences.map((x) => (
            <RecordBlock
              key={x.id}
              title={x.title}
              subtitle={x.organization}
              meta={[formatRange(x.startDate, x.endDate, x.isCurrent), x.location, EXPERIENCE_KIND_LABEL[x.kind]]}
              provenance={x.provenance}
              hidden={x.hidden}
              sourceCount={x.sources.filter((s) => s.type === 'document').length}
              evidence={bySubject.get(x.id) ?? []}
              filter={filter}
              onEdit={() => setRecordDialog({ kind: 'experience', record: x })}
              onDelete={() => del('experiences', x.id)}
              onToggleHidden={() => toggle('experiences', x.id, x.hidden)}
              onAddEvidence={() => setAddEvidence({ subjectId: x.id, label: `${x.title}, ${x.organization}` })}
            />
          ))}
          {!brain.experiences.length && <p className="text-[13px] text-mist">No experience yet.</p>}
        </div>
      </section>

      <section>
        <SectionTitle
          icon={<LuGraduationCap />}
          action={
            <Button size="sm" variant="ghost" icon={<LuPlus className="size-3.5" />} onClick={() => setRecordDialog({ kind: 'education', record: null })}>
              Add education
            </Button>
          }
        >
          Education
        </SectionTitle>
        <div className="flex flex-col gap-3">
          {brain.education.map((d) => (
            <RecordBlock
              key={d.id}
              title={[d.degree, d.field].filter(Boolean).join(', ') || d.institution}
              subtitle={d.institution}
              meta={[formatRange(d.startDate, d.endDate, false), d.grade, d.minor && `Minor: ${d.minor}`, d.coursework.length ? `Coursework: ${d.coursework.join(', ')}` : '']}
              provenance={d.provenance}
              hidden={d.hidden}
              sourceCount={d.sources.filter((s) => s.type === 'document').length}
              evidence={bySubject.get(d.id) ?? []}
              filter={filter}
              onEdit={() => setRecordDialog({ kind: 'education', record: d })}
              onDelete={() => del('education', d.id)}
              onToggleHidden={() => toggle('education', d.id, d.hidden)}
              onAddEvidence={() => setAddEvidence({ subjectId: d.id, label: d.institution })}
            />
          ))}
        </div>
      </section>

      {(
        <section>
          <SectionTitle
            icon={<LuFolderKanban />}
            action={
              <Button size="sm" variant="ghost" icon={<LuPlus className="size-3.5" />} onClick={() => setRecordDialog({ kind: 'project', record: null })}>
                Add project
              </Button>
            }
          >
            Projects
          </SectionTitle>
          <div className="flex flex-col gap-3">
            {brain.projects.map((p) => (
              <RecordBlock
                key={p.id}
                title={p.name}
                subtitle={[p.context, p.role].filter(Boolean).join(', ') || 'Project'}
                meta={[formatRange(p.startDate, p.endDate, false), p.technologies.join(', ')]}
                provenance={p.provenance}
                hidden={p.hidden}
                sourceCount={p.sources.filter((s) => s.type === 'document').length}
                evidence={bySubject.get(p.id) ?? []}
                filter={filter}
                onEdit={() => setRecordDialog({ kind: 'project', record: p })}
                onDelete={() => del('projects', p.id)}
                onToggleHidden={() => toggle('projects', p.id, p.hidden)}
                onAddEvidence={() => setAddEvidence({ subjectId: p.id, label: p.name })}
              />
            ))}
            {!brain.projects.length && <p className="text-[13px] text-mist">No projects yet.</p>}
          </div>
        </section>
      )}

      {general.length > 0 && (
        <section>
          <SectionTitle icon={<LuLayers />}>Other evidence</SectionTitle>
          <div className="rounded-panel border border-rule bg-surface px-5 py-4">
            <EvidenceList items={general} filter={filter} onAdd={() => setAddEvidence({ subjectId: null, label: 'General' })} />
          </div>
        </section>
      )}

      <SkillsSection skills={brain.skills} />

      {recordDialog && <RecordDialog kind={recordDialog.kind} record={recordDialog.record} onClose={() => setRecordDialog(null)} />}
      {addEvidence && <AddEvidenceDialog subjectId={addEvidence.subjectId} subjectLabel={addEvidence.label} onClose={() => setAddEvidence(null)} />}
    </div>
  );
}
