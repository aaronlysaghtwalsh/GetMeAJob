import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import JSZip from 'jszip';

const require = createRequire(import.meta.url);

export type FileKind = 'pdf' | 'docx' | 'text' | 'image';

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

const IMAGE_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };

/** Detect the real file type from magic bytes (never trust the client-provided MIME type). */
export function detectKind(buf: Buffer, filename: string): { kind: FileKind; mime: string } | null {
  const ext = path.extname(filename).slice(1).toLowerCase();
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return { kind: 'pdf', mime: 'application/pdf' };
  if (buf[0] === 0x50 && buf[1] === 0x4b && (ext === 'docx' || ext === 'zip' || !ext)) {
    return { kind: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
  }
  if (buf[0] === 0x89 && buf.subarray(1, 4).toString('latin1') === 'PNG') return { kind: 'image', mime: 'image/png' };
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { kind: 'image', mime: 'image/jpeg' };
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return { kind: 'image', mime: 'image/webp' };
  if (buf.subarray(0, 3).toString('latin1') === 'GIF') return { kind: 'image', mime: 'image/gif' };
  if (['txt', 'md', 'markdown', 'text', 'csv', 'json', 'rtf', ''].includes(ext) || !ext) {
    const sample = buf.subarray(0, 4096);
    const nonText = [...sample].filter((b) => b === 0 || (b < 9 && b !== 0)).length;
    if (nonText === 0) return { kind: 'text', mime: 'text/plain' };
  }
  if (IMAGE_TYPES[ext]) return null;
  return null;
}

/* PDF ------------------------------------------------------------------------------------------------ */

let pdfjsPromise: Promise<any> | null = null;
function loadPdfjs() {
  pdfjsPromise ??= import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjsPromise;
}

/** Extract text from a PDF, rebuilding lines from positioned text items. */
export async function pdfToText(buf: Buffer): Promise<{ text: string; pages: number }> {
  const pdfjs = await loadPdfjs();
  // Point pdf.js at its bundled standard fonts (as a file:// URL, which also works on Windows).
  // Added 7 Oct 2026 during the first live run with real resume PDFs.
  const fontDir = path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts');
  const fontDirUrl = pathToFileURL(fontDir + path.sep).href;
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buf),
    isEvalSupported: false,
    useSystemFonts: false,
    standardFontDataUrl: fontDirUrl,
    verbosity: 0,
  });
  const doc = await loadingTask.promise;
  const pages: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const lines: { y: number; parts: { x: number; str: string; w: number }[] }[] = [];
    for (const item of content.items as any[]) {
      if (typeof item.str !== 'string') continue;
      const x = item.transform[4];
      const y = item.transform[5];
      let line = lines.find((l) => Math.abs(l.y - y) < Math.max(2, (item.height || 10) * 0.4));
      if (!line) {
        line = { y, parts: [] };
        lines.push(line);
      }
      line.parts.push({ x, str: item.str, w: item.width ?? 0 });
    }
    lines.sort((a, b) => b.y - a.y);
    const text = lines
      .map((l) => {
        l.parts.sort((a, b) => a.x - b.x);
        let out = '';
        let lastEnd = -Infinity;
        for (const part of l.parts) {
          if (out && part.x - lastEnd > 2 && !out.endsWith(' ') && !part.str.startsWith(' ')) out += ' ';
          out += part.str;
          lastEnd = part.x + part.w;
        }
        return out.replace(/\s+$/, '');
      })
      .filter((l) => l.trim())
      .join('\n');
    pages.push(text);
    page.cleanup();
  }
  await loadingTask.destroy();
  return { text: pages.join('\n\n'), pages: pages.length };
}

/* DOCX ----------------------------------------------------------------------------------------------- */

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

function paragraphsFromXml(xml: string): string[] {
  const out: string[] = [];
  const paraRe = /<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>/g;
  let m: RegExpExecArray | null;
  while ((m = paraRe.exec(xml))) {
    const p = m[0];
    const isList = /<w:numPr>/.test(p);
    let text = '';
    const tokenRe = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>|<w:cr\/>/g;
    let t: RegExpExecArray | null;
    while ((t = tokenRe.exec(p))) {
      if (t[0].startsWith('<w:tab')) text += '\t';
      else if (t[0].startsWith('<w:br') || t[0].startsWith('<w:cr')) text += '\n';
      else text += decodeXml(t[1]);
    }
    if (text.trim()) out.push(isList ? `• ${text.trim()}` : text.replace(/\s+$/, ''));
  }
  return out;
}

export async function docxToText(buf: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const main = zip.file('word/document.xml');
  if (!main) throw new Error('This file is not a valid Word document.');
  const parts: string[] = [];
  const headerFiles = Object.keys(zip.files).filter((n) => /^word\/header\d*\.xml$/.test(n)).sort();
  for (const h of headerFiles) parts.push(...paragraphsFromXml(await zip.file(h)!.async('string')));
  parts.push(...paragraphsFromXml(await main.async('string')));
  const footerFiles = Object.keys(zip.files).filter((n) => /^word\/footer\d*\.xml$/.test(n)).sort();
  for (const f of footerFiles) parts.push(...paragraphsFromXml(await zip.file(f)!.async('string')));
  return parts.join('\n');
}

/* Plain text ---------------------------------------------------------------------------------------------- */

export function bufferToText(buf: Buffer): string {
  let text = buf.toString('utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text.replace(/\r\n?/g, '\n');
}

/** Light cleanup shared by all extractors: normalize line endings, trim trailing spaces, collapse blank runs. */
export function cleanExtractedText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
