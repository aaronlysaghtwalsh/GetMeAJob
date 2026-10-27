import { useRef, useState, type DragEvent } from 'react';
import { LuDownload, LuEllipsis, LuEye, LuFileText, LuPencil, LuRefreshCw, LuTrash2, LuUpload, LuTriangleAlert } from 'react-icons/lu';
import { api, ApiError } from '../../lib/api';
import { useQuery, invalidate } from '../../lib/query';
import { useAction } from '../../lib/actions';
import { bytes, relativeTime } from '../../lib/format';
import type { DocumentDTO, TaskDTO } from '../../lib/types';
import { DOCUMENT_KINDS, DOCUMENT_KIND_LABEL } from '../../../shared/constants';
import { Badge, Button, Callout, Checkbox, EmptyState, Field, Input, Select, Skeleton, Spinner } from '../../components/ui/primitives';
import { Dialog, Menu, useToast } from '../../components/ui/overlays';
import { cn } from '../../components/ui/cn';

const STATUS: Record<DocumentDTO['status'], { label: string; tone: 'neutral' | 'jade' | 'cobalt' | 'brick' | 'ochre' }> = {
  uploaded: { label: 'Waiting', tone: 'neutral' },
  extracting: { label: 'Reading', tone: 'cobalt' },
  extracted: { label: 'Read', tone: 'cobalt' },
  analyzing: { label: 'Analyzing', tone: 'cobalt' },
  analyzed: { label: 'In Career Brain', tone: 'jade' },
  failed: { label: 'Failed', tone: 'brick' },
};

const METHOD: Record<string, string> = {
  pdf_text: 'Text PDF',
  docx_xml: 'Word document',
  plain: 'Plain text',
  ai_vision: 'Image, read by AI',
  ai_pdf: 'Scanned PDF, read by AI',
};

export function UploadDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [files, setFiles] = useState<File[]>([]);
  const [kind, setKind] = useState<string>('resume');
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const add = (list: FileList | null) => {
    if (!list) return;
    setFiles((prev) => [...prev, ...Array.from(list)].slice(0, 10));
  };
  const submit = async () => {
    setBusy(true);
    try {
      const form = new FormData();
      form.append('kind', kind);
      for (const f of files) form.append('files', f, f.name);
      const r = await api.upload<{ documentIds: string[]; errors: string[]; task: TaskDTO | null }>('/api/documents', form);
      for (const e of r.errors) toast(e, 'error');
      if (r.documentIds.length) {
        toast(r.task ? `Uploaded ${r.documentIds.length} file${r.documentIds.length === 1 ? '' : 's'}. Building your Career Brain…` : 'Uploaded. Add an AI key in Settings to analyze it.', 'success');
        setFiles([]);
        onClose();
      }
      invalidate('/api/brain');
      invalidate('/api/documents');
    } catch (err) {
      toast((err as ApiError).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    add(e.dataTransfer.files);
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Upload documents"
      description="Resumes, CVs, cover letters, transcripts, certificates or project write-ups. PDF, DOCX, TXT, PNG or JPEG, up to 15 MB each."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!files.length} onClick={() => void submit()}>
            Upload {files.length ? `${files.length} file${files.length === 1 ? '' : 's'}` : ''}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={onDrop}
          onClick={() => input.current?.click()}
          className={cn(
            'flex cursor-pointer flex-col items-center justify-center rounded-panel border-2 border-dashed px-6 py-10 text-center transition-colors',
            drag ? 'border-cobalt bg-cobalt-tint/50' : 'border-rule-strong hover:border-mist',
          )}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
        >
          <LuUpload className="size-6 text-mist" />
          <div className="mt-2 text-sm font-medium text-ink">Drop files here or click to choose</div>
          <div className="mt-1 text-[12.5px] text-graphite">Several resume versions are welcome. They are merged, not duplicated.</div>
          <input
            ref={input}
            type="file"
            multiple
            accept=".pdf,.docx,.txt,.md,.png,.jpg,.jpeg,.webp"
            className="hidden"
            onChange={(e) => {
              add(e.target.files);
              e.target.value = '';
            }}
          />
        </div>
        {files.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-3 rounded-control bg-paper px-3 py-2 text-[13px]">
                <span className="flex min-w-0 items-center gap-2">
                  <LuFileText className="size-4 shrink-0 text-mist" />
                  <span className="truncate text-ink">{f.name}</span>
                  <span className="shrink-0 text-mist">{bytes(f.size)}</span>
                </span>
                <button type="button" className="text-graphite hover:text-brick" onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <Field label="What are these?" hint="Applies to every file in this upload. You can change it per document later.">
          <Select value={kind} onChange={(e) => setKind(e.target.value)}>
            {DOCUMENT_KINDS.map((k) => (
              <option key={k} value={k}>
                {DOCUMENT_KIND_LABEL[k]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Dialog>
  );
}

function TextViewer({ doc, onClose }: { doc: DocumentDTO; onClose: () => void }) {
  const { data, loading } = useQuery<{ text: string }>(`/api/documents/${doc.id}/text`);
  return (
    <Dialog open onClose={onClose} title={doc.label} description={`Text extracted from ${doc.filename} (${METHOD[doc.textMethod ?? ''] ?? 'pending'}). This is exactly what the AI reads.`} size="lg">
      {loading ? <Spinner /> : <pre className="font-doc text-[13px] leading-relaxed whitespace-pre-wrap text-ink">{data?.text || 'No text extracted yet.'}</pre>}
    </Dialog>
  );
}

export function DocumentsTab({ onUpload }: { onUpload: () => void }) {
  const { data, loading } = useQuery<{ documents: DocumentDTO[]; tasks: TaskDTO[] }>('/api/documents');
  const { run, busy } = useAction();
  const [viewing, setViewing] = useState<DocumentDTO | null>(null);
  const [renaming, setRenaming] = useState<DocumentDTO | null>(null);
  const [label, setLabel] = useState('');
  const [deleting, setDeleting] = useState<DocumentDTO | null>(null);
  const [purge, setPurge] = useState(false);
  if (loading || !data) return <Skeleton className="h-40 w-full" />;
  const docs = data.documents;
  const pending = docs.filter((d) => !d.includedInBrain && d.status !== 'failed');
  const failed = docs.filter((d) => d.status === 'failed');
  const running = data.tasks.some((t) => t.type === 'brain.ingest');
  const refresh = ['/api/documents', '/api/brain'];

  if (!docs.length) {
    return (
      <div className="rounded-panel border border-dashed border-rule-strong bg-surface">
        <EmptyState icon={<LuFileText />} title="No documents yet" action={<Button variant="primary" onClick={onUpload} icon={<LuUpload className="size-4" />}>Upload documents</Button>}>
          Your originals are stored encrypted and never edited. Everything extracted from them stays linked back to the exact text.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {(pending.length > 0 || failed.length > 0) && !running && (
        <Callout
          tone={failed.length ? 'brick' : 'cobalt'}
          icon={failed.length ? <LuTriangleAlert /> : <LuRefreshCw />}
          title={failed.length ? `${failed.length} document${failed.length === 1 ? '' : 's'} could not be processed` : `${pending.length} document${pending.length === 1 ? ' is' : 's are'} not in your Career Brain yet`}
          action={
            <Button
              size="sm"
              variant="primary"
              loading={busy === 'rebuild'}
              onClick={() => void run('rebuild', () => api.post('/api/brain/rebuild', { documentIds: [...pending, ...failed].map((d) => d.id) }), { refresh, success: 'Processing started.' })}
            >
              Process now
            </Button>
          }
        >
          {failed[0]?.error ?? 'Process them to extract roles, evidence and skills.'}
        </Callout>
      )}
      <div className="overflow-hidden rounded-panel border border-rule bg-surface">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-rule bg-paper/60 text-[12.5px] text-graphite">
            <tr>
              <th className="px-5 py-2.5 font-medium">Document</th>
              <th className="hidden px-3 py-2.5 font-medium md:table-cell">Type</th>
              <th className="px-3 py-2.5 font-medium">Status</th>
              <th className="hidden px-3 py-2.5 font-medium sm:table-cell">Added</th>
              <th className="w-10 px-3 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-rule">
            {docs.map((d) => (
              <tr key={d.id} className="hover:bg-paper/50">
                <td className="px-5 py-3">
                  <div className="flex items-center gap-2.5">
                    <LuFileText className="size-4 shrink-0 text-mist" />
                    <div className="min-w-0">
                      <div className="truncate font-medium text-ink">{d.label}</div>
                      <div className="truncate text-[12px] text-graphite">
                        {d.filename}, {bytes(d.size)}
                        {d.textMethod ? `, ${METHOD[d.textMethod] ?? d.textMethod}` : ''}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="hidden px-3 py-3 text-[13px] text-ink-soft md:table-cell">{DOCUMENT_KIND_LABEL[d.kind]}</td>
                <td className="px-3 py-3">
                  <Badge tone={STATUS[d.status].tone}>
                    {['extracting', 'analyzing'].includes(d.status) && <Spinner className="size-3" />}
                    {STATUS[d.status].label}
                  </Badge>
                </td>
                <td className="hidden px-3 py-3 text-[13px] text-graphite sm:table-cell">{relativeTime(d.createdAt)}</td>
                <td className="px-3 py-3 text-right">
                  <Menu
                    button={
                      <button type="button" aria-label="Document actions" className="rounded p-1.5 text-graphite hover:bg-ink/5 hover:text-ink">
                        <LuEllipsis className="size-4" />
                      </button>
                    }
                    items={[
                      { label: 'View extracted text', icon: <LuEye />, onSelect: () => setViewing(d), disabled: !d.textLength },
                      { label: 'Download original', icon: <LuDownload />, onSelect: () => window.open(`/api/documents/${d.id}/file`, '_blank') },
                      {
                        label: 'Rename',
                        icon: <LuPencil />,
                        onSelect: () => {
                          setRenaming(d);
                          setLabel(d.label);
                        },
                      },
                      { label: 'Process again', icon: <LuRefreshCw />, onSelect: () => void run('rebuild', () => api.post('/api/brain/rebuild', { documentIds: [d.id] }), { refresh, success: 'Processing started.' }) },
                      'divider',
                      { label: 'Delete', icon: <LuTrash2 />, danger: true, onSelect: () => setDeleting(d) },
                    ]}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {viewing && <TextViewer doc={viewing} onClose={() => setViewing(null)} />}
      <Dialog
        open={!!renaming}
        onClose={() => setRenaming(null)}
        title="Rename document"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRenaming(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={async () => {
                if (!renaming) return;
                await run('rename', () => api.patch(`/api/documents/${renaming.id}`, { label }), { refresh });
                setRenaming(null);
              }}
            >
              Save
            </Button>
          </>
        }
      >
        <Field label="Name" hint='Resume names appear in strategies, e.g. "Resume (data focus)".'>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} autoFocus />
        </Field>
      </Dialog>
      <Dialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={`Delete "${deleting?.label}"?`}
        description="The original file is permanently deleted."
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={busy === 'delete'}
              onClick={async () => {
                if (!deleting) return;
                await run('delete', () => api.delete(`/api/documents/${deleting.id}${purge ? '?purge=1' : ''}`), { refresh, success: 'Document deleted.' });
                setDeleting(null);
                setPurge(false);
              }}
            >
              Delete document
            </Button>
          </>
        }
      >
        <Checkbox
          label="Also remove facts that came only from this document"
          description="Otherwise they stay in your Career Brain, marked as needing your confirmation because their source is gone."
          checked={purge}
          onChange={setPurge}
        />
      </Dialog>
    </div>
  );
}
