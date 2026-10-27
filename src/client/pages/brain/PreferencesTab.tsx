import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { LuShieldAlert } from 'react-icons/lu';
import { api } from '../../lib/api';
import { useQuery, setQueryData, invalidate } from '../../lib/query';
import { useAction } from '../../lib/actions';
import { addNavigationGuard } from '../../lib/router';
import type { Preferences } from '../../lib/types';
import { WORK_TYPES, WORK_TYPE_LABEL, VOICES, VOICE_LABEL } from '../../../shared/constants';
import { Button, Field, Input, Select, Skeleton, Textarea, ToggleGroup } from '../../components/ui/primitives';
import { TagInput } from '../../components/ui/overlays';

function Group({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section className="grid grid-cols-[minmax(0,1fr)] gap-4 border-b border-rule py-7 first:pt-0 last:border-0 md:grid-cols-[240px_minmax(0,1fr)] md:gap-10">
      <div>
        <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
        {description && <p className="mt-1 text-[13px] leading-relaxed text-graphite">{description}</p>}
      </div>
      <div className="flex min-w-0 flex-col gap-5">{children}</div>
    </section>
  );
}

const tri = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
  { value: 'unsure', label: 'Not sure' },
];

function num(v: string): number | null {
  const n = Number(v.replace(/[^0-9.]/g, ''));
  return v.trim() && Number.isFinite(n) ? n : null;
}

export function PreferencesTab() {
  const { data, loading } = useQuery<Preferences>('/api/preferences');
  const [form, setForm] = useState<Preferences | null>(null);
  const { run, busy } = useAction();
  useEffect(() => {
    if (data && !form) setForm(data);
  }, [data, form]);
  const dirty = useMemo(() => !!form && !!data && JSON.stringify(form) !== JSON.stringify(data), [form, data]);
  useEffect(() => addNavigationGuard(() => (dirty ? 'You have unsaved preference changes. Leave without saving?' : null)), [dirty]);
  if (loading || !form) return <Skeleton className="h-96 w-full" />;
  const set = <K extends keyof Preferences>(k: K, v: Preferences[K]) => setForm({ ...form, [k]: v });
  const wa = form.workAuthorization;
  const comp = form.compensation;

  const save = async () => {
    const saved = await run('save', () => api.put<Preferences>('/api/preferences', form), { success: 'Preferences saved.' });
    if (saved) {
      setQueryData('/api/preferences', saved);
      setForm(saved);
      invalidate('/api/brain');
      invalidate('/api/dashboard');
    }
  };

  return (
    <div className="pb-24">
      <Group title="Roles you want" description="Used for fit scoring and to spot better-matched roles you might not have considered.">
        <Field label="Target roles">
          <TagInput
            value={form.targetRoles}
            onChange={(v) => set('targetRoles', v)}
            placeholder="e.g. Customer Insights Analyst"
            suggestions={['Data Analyst', 'Business Analyst', 'Technical Account Manager', 'Customer Success Manager', 'Sales Development Representative', 'Product Analyst']}
          />
        </Field>
        <Field label="Roles to avoid" optional>
          <TagInput value={form.avoidRoles} onChange={(v) => set('avoidRoles', v)} placeholder="e.g. Software Engineer" />
        </Field>
        <Field label="Kinds of work you enjoy">
          <ToggleGroup multiple options={WORK_TYPES.map((w) => ({ value: w, label: WORK_TYPE_LABEL[w] }))} value={form.workTypes} onChange={(v) => set('workTypes', v)} />
        </Field>
        <Field label="Seniority">
          <ToggleGroup
            multiple
            options={[
              { value: 'internship', label: 'Internship' },
              { value: 'entry', label: 'Entry level' },
              { value: 'associate', label: 'Associate' },
              { value: 'mid', label: 'Mid level' },
              { value: 'senior', label: 'Senior' },
            ]}
            value={form.seniority}
            onChange={(v) => set('seniority', v)}
          />
        </Field>
        <Field label="Industries of interest" optional>
          <TagInput value={form.industries} onChange={(v) => set('industries', v)} suggestions={['SaaS', 'Cybersecurity', 'Retail', 'Consulting', 'Fintech', 'Healthcare']} />
        </Field>
        <Field label="Industries to avoid" optional>
          <TagInput value={form.avoidIndustries} onChange={(v) => set('avoidIndustries', v)} />
        </Field>
      </Group>

      <Group title="Location" description="Roles outside these are flagged in fit analysis.">
        <Field label="Locations" hint="Cities or regions, e.g. Chicago, IL">
          <TagInput value={form.locations} onChange={(v) => set('locations', v)} />
        </Field>
        <Field label="Work models">
          <ToggleGroup
            multiple
            options={[
              { value: 'onsite', label: 'On-site' },
              { value: 'hybrid', label: 'Hybrid' },
              { value: 'remote', label: 'Remote' },
            ]}
            value={form.workModels}
            onChange={(v) => set('workModels', v)}
          />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Maximum commute (minutes)" optional>
            <Input inputMode="numeric" value={form.maxCommuteMinutes ?? ''} onChange={(e) => set('maxCommuteMinutes', num(e.target.value))} />
          </Field>
          <Field label="Open to relocation">
            <Select value={form.openToRelocation} onChange={(e) => set('openToRelocation', e.target.value as Preferences['openToRelocation'])}>
              <option value="yes">Yes</option>
              <option value="maybe">Maybe</option>
              <option value="no">No</option>
            </Select>
          </Field>
        </div>
      </Group>

      <Group
        title="Work authorization"
        description={
          <span className="inline-flex gap-1.5">
            <LuShieldAlert className="mt-0.5 size-3.5 shrink-0 text-ochre" />
            Used to flag roles you cannot accept and to draft screening answers. These answers are always shown to you for review before any application.
          </span>
        }
      >
        <Field label="Country you are applying in">
          <Input value={wa.country} onChange={(e) => set('workAuthorization', { ...wa, country: e.target.value })} className="max-w-xs" />
        </Field>
        <Field label="Are you legally authorized to work there?">
          <ToggleGroup options={tri} value={wa.authorizedToWork} onChange={(v) => set('workAuthorization', { ...wa, authorizedToWork: v })} />
        </Field>
        <Field label="Do you need visa sponsorship now?">
          <ToggleGroup options={tri} value={wa.requiresSponsorshipNow} onChange={(v) => set('workAuthorization', { ...wa, requiresSponsorshipNow: v })} />
        </Field>
        <Field label="Will you need sponsorship in the future?">
          <ToggleGroup options={tri} value={wa.requiresSponsorshipFuture} onChange={(v) => set('workAuthorization', { ...wa, requiresSponsorshipFuture: v })} />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Visa or status" optional>
            <Input value={wa.visaType} onChange={(e) => set('workAuthorization', { ...wa, visaType: e.target.value })} />
          </Field>
          <Field label="Valid until" optional>
            <Input value={wa.visaExpiry} onChange={(e) => set('workAuthorization', { ...wa, visaExpiry: e.target.value })} placeholder="YYYY-MM" />
          </Field>
        </div>
        <Field label="Notes on employer eligibility" optional hint="Anything an employer needs to know, in your words.">
          <Textarea value={wa.notes} onChange={(e) => set('workAuthorization', { ...wa, notes: e.target.value })} rows={2} />
        </Field>
      </Group>

      <Group title="Compensation" description="Used to flag under-paying roles and to keep salary answers consistent.">
        <div className="grid gap-5 sm:grid-cols-3">
          <Field label="Minimum">
            <Input inputMode="numeric" value={comp.minimum ?? ''} onChange={(e) => set('compensation', { ...comp, minimum: num(e.target.value) })} placeholder="65000" />
          </Field>
          <Field label="Target">
            <Input inputMode="numeric" value={comp.target ?? ''} onChange={(e) => set('compensation', { ...comp, target: num(e.target.value) })} />
          </Field>
          <Field label="Upper end" optional>
            <Input inputMode="numeric" value={comp.maximum ?? ''} onChange={(e) => set('compensation', { ...comp, maximum: num(e.target.value) })} />
          </Field>
        </div>
        <div className="grid gap-5 sm:grid-cols-3">
          <Field label="Currency">
            <Input value={comp.currency} onChange={(e) => set('compensation', { ...comp, currency: e.target.value.toUpperCase() })} />
          </Field>
          <Field label="Per">
            <Select value={comp.period} onChange={(e) => set('compensation', { ...comp, period: e.target.value as 'year' | 'hour' })}>
              <option value="year">Year</option>
              <option value="hour">Hour</option>
            </Select>
          </Field>
        </div>
      </Group>

      <Group title="Timing and travel">
        <div className="grid gap-5 sm:grid-cols-3">
          <Field label="Available from">
            <Input value={form.availability.availableFrom} onChange={(e) => set('availability', { ...form.availability, availableFrom: e.target.value })} placeholder="2026-06 or Immediately" />
          </Field>
          <Field label="Latest start" optional>
            <Input value={form.availability.latestStart} onChange={(e) => set('availability', { ...form.availability, latestStart: e.target.value })} />
          </Field>
          <Field label="Notice period" optional>
            <Input value={form.availability.noticePeriod} onChange={(e) => set('availability', { ...form.availability, noticePeriod: e.target.value })} />
          </Field>
        </div>
        <Field label="Travel">
          <ToggleGroup
            options={[
              { value: 'none', label: 'None' },
              { value: 'occasional', label: 'Occasional' },
              { value: 'frequent', label: 'Frequent' },
              { value: 'any', label: 'Any' },
            ]}
            value={form.travel}
            onChange={(v) => set('travel', v)}
          />
        </Field>
      </Group>

      <Group title="Company preferences">
        <Field label="Company size">
          <ToggleGroup
            multiple
            options={[
              { value: 'startup', label: 'Startup' },
              { value: 'scaleup', label: 'Scale-up' },
              { value: 'midsize', label: 'Mid-size' },
              { value: 'enterprise', label: 'Enterprise' },
            ]}
            value={form.companySizes}
            onChange={(v) => set('companySizes', v)}
          />
        </Field>
        <Field label="Company type">
          <ToggleGroup
            multiple
            options={[
              { value: 'public', label: 'Public' },
              { value: 'private', label: 'Private' },
              { value: 'nonprofit', label: 'Nonprofit' },
              { value: 'government', label: 'Government' },
              { value: 'academic', label: 'Academic' },
            ]}
            value={form.companyTypes}
            onChange={(v) => set('companyTypes', v)}
          />
        </Field>
      </Group>

      <Group title="Goals and dealbreakers" description="Shapes positioning and when GetMeAJob tells you not to apply.">
        <Field label="Where you want your career to go" optional>
          <Textarea value={form.careerGoals} onChange={(e) => set('careerGoals', e.target.value)} rows={3} />
        </Field>
        <Field label="Dealbreakers" optional>
          <Textarea value={form.dealbreakers} onChange={(e) => set('dealbreakers', e.target.value)} rows={2} placeholder="e.g. commission-only pay, fully on-site outside Chicago" />
        </Field>
      </Group>

      <Group title="Your writing voice" description="Cover letters and answers follow this. A short sample of your own writing helps most.">
        <Field label="Voice">
          <ToggleGroup options={VOICES.map((v) => ({ value: v, label: VOICE_LABEL[v] }))} value={form.writingVoice} onChange={(v) => v && set('writingVoice', v)} />
        </Field>
        <Field label="Sample of your writing" optional hint="An email, a LinkedIn post or a paragraph you wrote yourself. Used for tone only, never as content.">
          <Textarea value={form.writingSample} onChange={(e) => set('writingSample', e.target.value)} rows={5} />
        </Field>
      </Group>

      {dirty && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-rule bg-surface/95 backdrop-blur lg:left-[236px]">
          <div className="mx-auto flex max-w-[1240px] items-center justify-end gap-3 px-4 py-3 sm:px-6 lg:px-10">
            <span className="text-[13px] text-graphite">Unsaved changes</span>
            <Button variant="ghost" onClick={() => setForm(data!)}>
              Discard
            </Button>
            <Button variant="primary" loading={busy === 'save'} onClick={() => void save()}>
              Save preferences
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
