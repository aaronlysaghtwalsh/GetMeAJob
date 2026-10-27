import { useState } from 'react';
import { LuCalendarPlus, LuLink, LuMail, LuPlus, LuTrash2, LuUser } from 'react-icons/lu';
import { api } from '../../../lib/api';
import { useAction } from '../../../lib/actions';
import { formatDate, formatDateTime, localDateTimeInput, relativeTime } from '../../../lib/format';
import type { ContactDTO, WorkspaceData } from '../../../lib/types';
import { CONTACT_ROLES, CONTACT_ROLE_LABEL } from '../../../../shared/constants';
import { Badge, Button, Field, Input, Panel, Select, Textarea } from '../../../components/ui/primitives';
import { Dialog } from '../../../components/ui/overlays';
import { refreshKeys } from './shared';

const EVENT_TYPES = [
  { value: 'interview', label: 'Interview scheduled or held' },
  { value: 'follow_up', label: 'Followed up' },
  { value: 'message', label: 'Message received' },
  { value: 'note', label: 'Other update' },
] as const;

function NextActionPanel({ data }: { data: WorkspaceData }) {
  const app = data.application;
  const [action, setAction] = useState(app.nextAction);
  const [date, setDate] = useState(app.nextActionDate ?? '');
  const { run, busy } = useAction();
  const dirty = action !== app.nextAction || date !== (app.nextActionDate ?? '');
  return (
    <Panel title="Next action">
      <div className="flex flex-col gap-3">
        <Field label="What">
          <Input value={action} onChange={(e) => setAction(e.target.value)} placeholder="e.g. Follow up with the recruiter" />
        </Field>
        <Field label="By">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        {dirty && (
          <Button
            size="sm"
            variant="primary"
            loading={busy === 'save'}
            onClick={() => void run('save', () => api.patch(`/api/applications/${app.id}`, { nextAction: action, nextActionDate: date || null }), { refresh: refreshKeys(app.id), success: 'Saved.' })}
          >
            Save
          </Button>
        )}
      </div>
    </Panel>
  );
}

function ContactDialog({ appId, contact, onClose }: { appId: string; contact: ContactDTO | null; onClose: () => void }) {
  const [form, setForm] = useState({
    name: contact?.name ?? '',
    role: contact?.role ?? 'recruiter',
    title: contact?.title ?? '',
    email: contact?.email ?? '',
    linkedinUrl: contact?.linkedinUrl ?? '',
    notes: contact?.notes ?? '',
  });
  const { run, busy } = useAction();
  return (
    <Dialog
      open
      onClose={onClose}
      title={contact ? 'Edit contact' : 'Add contact'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!form.name.trim()}
            loading={!!busy}
            onClick={async () => {
              const r = await run('save', () => (contact ? api.patch(`/api/applications/${appId}/contacts/${contact.id}`, form) : api.post(`/api/applications/${appId}/contacts`, form)), { refresh: refreshKeys(appId) });
              if (r) onClose();
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
        </Field>
        <Field label="Role">
          <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as ContactDTO['role'] })}>
            {CONTACT_ROLES.map((r) => (
              <option key={r} value={r}>
                {CONTACT_ROLE_LABEL[r]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Job title" optional>
          <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </Field>
        <Field label="Email" optional>
          <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field label="LinkedIn" optional className="sm:col-span-2">
          <Input value={form.linkedinUrl} onChange={(e) => setForm({ ...form, linkedinUrl: e.target.value })} />
        </Field>
        <Field label="Notes" optional className="sm:col-span-2">
          <Textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </Field>
      </div>
      <p className="mt-3 text-[12px] text-mist">A hiring manager’s name is used in the cover letter greeting.</p>
    </Dialog>
  );
}

export function TrackingTab({ data }: { data: WorkspaceData }) {
  const id = data.application.id;
  const { run, busy } = useAction();
  const [eventOpen, setEventOpen] = useState(false);
  const [event, setEvent] = useState<{ type: string; title: string; occurredAt: string }>({ type: 'interview', title: '', occurredAt: localDateTimeInput() });
  const [contact, setContact] = useState<ContactDTO | null | 'new'>(null);
  const [note, setNote] = useState('');

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-w-0 flex-col gap-6">
        <Panel
          title="Timeline"
          actions={
            <Button size="sm" icon={<LuCalendarPlus className="size-3.5" />} onClick={() => setEventOpen(true)}>
              Log an update
            </Button>
          }
        >
          <ol className="relative flex flex-col gap-4 border-l border-rule pl-5">
            {data.events.map((e) => (
              <li key={e.id} className="relative">
                <span className="absolute top-1.5 -left-[24.5px] size-2 rounded-full bg-rule-strong ring-4 ring-surface" />
                <div className="text-sm text-ink">{e.title}</div>
                <div className="text-[12px] text-graphite" title={formatDateTime(e.occurredAt)}>
                  {formatDate(e.occurredAt)}, {relativeTime(e.occurredAt)}
                </div>
              </li>
            ))}
          </ol>
        </Panel>

        <Panel title="Notes">
          <div className="flex gap-2">
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything worth remembering about this application" />
            <Button
              variant="primary"
              className="self-end"
              disabled={!note.trim()}
              loading={busy === 'note'}
              onClick={async () => {
                const r = await run('note', () => api.post(`/api/applications/${id}/notes`, { body: note }), { refresh: refreshKeys(id) });
                if (r) setNote('');
              }}
            >
              Add
            </Button>
          </div>
          <ul className="mt-4 flex flex-col gap-3">
            {data.notes.map((n) => (
              <li key={n.id} className="group flex items-start justify-between gap-3 rounded-control bg-paper px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm whitespace-pre-wrap text-ink">{n.body}</p>
                  <p className="mt-1 text-[12px] text-mist">{relativeTime(n.createdAt)}</p>
                </div>
                <button type="button" aria-label="Delete note" className="rounded p-1 text-mist opacity-0 group-hover:opacity-100 hover:text-brick" onClick={() => void run('dn', () => api.delete(`/api/applications/${id}/notes/${n.id}`), { refresh: refreshKeys(id) })}>
                  <LuTrash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <aside className="flex flex-col gap-6">
        <NextActionPanel data={data} />
        <Panel
          title="Contacts"
          actions={
            <Button size="sm" variant="ghost" icon={<LuPlus className="size-3.5" />} onClick={() => setContact('new')}>
              Add
            </Button>
          }
        >
          <ul className="flex flex-col gap-3">
            {data.contacts.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => setContact(c)} className="w-full text-left">
                  <div className="flex items-center gap-2">
                    <LuUser className="size-3.5 text-mist" />
                    <span className="text-sm font-medium text-ink">{c.name}</span>
                    <Badge>{CONTACT_ROLE_LABEL[c.role]}</Badge>
                  </div>
                  {c.title && <div className="ml-5.5 text-[12.5px] text-graphite">{c.title}</div>}
                  <div className="ml-5.5 flex gap-3 text-[12px] text-graphite">
                    {c.email && (
                      <span className="inline-flex items-center gap-1">
                        <LuMail className="size-3" />
                        {c.email}
                      </span>
                    )}
                    {c.linkedinUrl && (
                      <span className="inline-flex items-center gap-1">
                        <LuLink className="size-3" /> LinkedIn
                      </span>
                    )}
                  </div>
                </button>
              </li>
            ))}
            {!data.contacts.length && <li className="text-[13px] text-mist">Recruiters, hiring managers and referrals for this role.</li>}
          </ul>
        </Panel>
      </aside>

      {contact && <ContactDialog appId={id} contact={contact === 'new' ? null : contact} onClose={() => setContact(null)} />}
      <Dialog
        open={eventOpen}
        onClose={() => setEventOpen(false)}
        title="Log an update"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEventOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!event.title.trim()}
              loading={busy === 'event'}
              onClick={async () => {
                // datetime-local values are local wall-clock time; send an unambiguous instant.
                const occurredAt = event.occurredAt ? new Date(event.occurredAt).toISOString() : undefined;
                const r = await run('event', () => api.post(`/api/applications/${id}/events`, { ...event, occurredAt }), { refresh: refreshKeys(id) });
                if (r) {
                  setEventOpen(false);
                  setEvent({ ...event, title: '' });
                }
              }}
            >
              Save
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Type">
            <Select value={event.type} onChange={(e) => setEvent({ ...event, type: e.target.value })}>
              {EVENT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="What happened">
            <Input value={event.title} onChange={(e) => setEvent({ ...event, title: e.target.value })} placeholder="Recruiter screen with Dana, 30 minutes" autoFocus />
          </Field>
          <Field label="When">
            <Input type="datetime-local" value={event.occurredAt} onChange={(e) => setEvent({ ...event, occurredAt: e.target.value })} />
          </Field>
          <p className="text-[12px] text-mist">Move the application to the matching stage from the stage menu at the top.</p>
        </div>
      </Dialog>
    </div>
  );
}
