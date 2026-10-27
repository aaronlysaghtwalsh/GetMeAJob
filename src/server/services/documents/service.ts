import { z } from 'zod/v4';
import type { App } from '../../app';
import { newId, nowIso } from '../../lib/ids';
import { sha256Hex } from '../../security/crypto';
import { audit } from '../../security/audit';
import { badRequest, conflict } from '../../http/core';
import { bufferToText, cleanExtractedText, detectKind, docxToText, MAX_UPLOAD_BYTES, pdfToText } from './parse';
import type { DocumentKind } from '../../../shared/constants';

export interface UploadInput {
  userId: string;
  filename: string;
  data: Buffer;
  kind: DocumentKind;
  label?: string;
  ip?: string;
}

/** Store an uploaded document (encrypted) and create its row. Text extraction happens in the ingest task. */
export async function storeDocument(app: App, input: UploadInput): Promise<string> {
  if (input.data.length === 0) throw badRequest(`"${input.filename}" is empty.`);
  if (input.data.length > MAX_UPLOAD_BYTES) throw badRequest(`"${input.filename}" is larger than 15 MB.`);
  const detected = detectKind(input.data, input.filename);
  if (!detected) throw badRequest(`"${input.filename}" is not a supported file. Upload PDF, DOCX, TXT/Markdown, PNG, JPEG or WebP.`);
  const hash = sha256Hex(input.data);
  const dupe = app.db.one<{ label: string }>('SELECT label FROM documents WHERE user_id = ? AND sha256 = ?', [input.userId, hash]);
  if (dupe) throw conflict(`"${input.filename}" is already uploaded as "${dupe.label}".`);
  const id = newId('doc');
  const storageKey = `${id}.bin`;
  await app.storage.put(input.userId, storageKey, input.data);
  const now = nowIso();
  const safeName = input.filename.replace(/[^\p{L}\p{N} ._()-]+/gu, '_').slice(0, 180) || 'document';
  app.db.run(
    `INSERT INTO documents (id, user_id, kind, label, filename, mime, size, sha256, storage_key, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'uploaded', ?, ?)`,
    [id, input.userId, input.kind, (input.label || safeName.replace(/\.[^.]+$/, '')).slice(0, 120), safeName, detected.mime, input.data.length, hash, storageKey, now, now],
  );
  audit(app.db, { userId: input.userId, action: 'document.uploaded', targetType: 'document', targetId: id, meta: { filename: safeName, kind: input.kind }, ip: input.ip });
  return id;
}

const TranscriptSchema = z.object({
  text: z.string().describe('All text in the document, transcribed exactly, preserving line breaks and reading order.'),
  notes: z.string().describe('Anything illegible or uncertain, else empty.'),
});

/**
 * Ensure the document's plain text is available. Text-based PDFs, DOCX and TXT are parsed locally;
 * images and scanned PDFs are transcribed by the AI provider's vision capability.
 */
export async function ensureDocumentText(app: App, userId: string, documentId: string, opts: { taskId?: string; signal?: AbortSignal } = {}): Promise<string> {
  const row = app.db.one<Record<string, any>>('SELECT * FROM documents WHERE id = ? AND user_id = ?', [documentId, userId]);
  if (!row) throw new Error('Document not found');
  if (row.text_content) return row.text_content as string;
  app.db.run(`UPDATE documents SET status = 'extracting', error = NULL, updated_at = ? WHERE id = ?`, [nowIso(), documentId]);
  try {
    const data = await app.storage.get(userId, row.storage_key);
    const detected = detectKind(data, row.filename);
    let text = '';
    let method = '';
    if (detected?.kind === 'pdf') {
      const parsed = await pdfToText(data);
      text = parsed.text;
      method = 'pdf_text';
      if (text.replace(/\s/g, '').length < 80 * Math.max(1, Math.min(parsed.pages, 3))) {
        const out = await app.ai.structured({
          userId,
          taskId: opts.taskId,
          task: 'vision',
          purpose: `Read scanned PDF: ${row.filename}`,
          system: 'You transcribe documents exactly. Do not summarize, correct or add anything.',
          prompt: [
            { type: 'pdf', data: data.toString('base64'), filename: row.filename },
            { type: 'text', text: 'Transcribe all text in this document exactly as written, in reading order.' },
          ],
          schema: TranscriptSchema,
          schemaName: 'transcript',
          signal: opts.signal,
        });
        text = out.text;
        method = 'ai_pdf';
      }
    } else if (detected?.kind === 'docx') {
      text = await docxToText(data);
      method = 'docx_xml';
    } else if (detected?.kind === 'text') {
      text = bufferToText(data);
      method = 'plain';
    } else if (detected?.kind === 'image') {
      const out = await app.ai.structured({
        userId,
        taskId: opts.taskId,
        task: 'vision',
        purpose: `Read image: ${row.filename}`,
        system: 'You transcribe documents exactly. Do not summarize, correct or add anything.',
        prompt: [
          { type: 'image', mediaType: detected.mime, data: data.toString('base64') },
          { type: 'text', text: 'Transcribe all text in this image exactly as written, preserving line breaks and reading order.' },
        ],
        schema: TranscriptSchema,
        schemaName: 'transcript',
        signal: opts.signal,
      });
      text = out.text;
      method = 'ai_vision';
    } else {
      throw new Error('Unsupported file type.');
    }
    text = cleanExtractedText(text);
    if (text.length < 20) throw new Error('No readable text was found in this file.');
    app.db.run(`UPDATE documents SET text_content = ?, text_method = ?, status = 'extracted', updated_at = ? WHERE id = ?`, [text, method, nowIso(), documentId]);
    return text;
  } catch (err) {
    app.db.run(`UPDATE documents SET status = 'failed', error = ?, updated_at = ? WHERE id = ?`, [(err as Error).message.slice(0, 500), nowIso(), documentId]);
    throw err;
  }
}
