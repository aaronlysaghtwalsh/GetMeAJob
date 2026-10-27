import {
  AlignmentType,
  BorderStyle,
  Document,
  LevelFormat,
  Packer,
  Paragraph,
  TabStopType,
  TextRun,
  type IParagraphOptions,
} from 'docx';
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';
import type { ResumeDoc } from '../../../shared/schemas/documents';

/* ------------------------------------------------------------------------------------------------
 * Shared: conservative, ATS-safe formatting
 *  - single column, no tables, text boxes, images, headers or footers
 *  - standard section headings, real bullet lists, consistent "Mon YYYY – Mon YYYY" dates
 *  - Arial in DOCX, Helvetica (metric-equivalent) in PDF, real text (never images)
 * ---------------------------------------------------------------------------------------------- */

const INK = '1F2937';
const MUTED = '4B5563';

/* DOCX ------------------------------------------------------------------------------------------- */

const PAGE = { width: 12240, margin: 864 }; // twips: 8.5in page, 0.6in margins
const TEXT_WIDTH = PAGE.width - PAGE.margin * 2;

function run(text: string, opts: { bold?: boolean; italics?: boolean; size?: number; color?: string } = {}) {
  return new TextRun({ text, font: 'Arial', bold: opts.bold, italics: opts.italics, size: opts.size ?? 20, color: opts.color ?? INK });
}

function sectionHeading(title: string): Paragraph {
  return new Paragraph({
    spacing: { before: 200, after: 80 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '9CA3AF', space: 2 } },
    children: [run(title, { bold: true, size: 22 })],
  });
}

function twoColumn(left: TextRun[], right: string, opts: Partial<IParagraphOptions> = {}): Paragraph {
  return new Paragraph({
    tabStops: [{ type: TabStopType.RIGHT, position: TEXT_WIDTH }],
    spacing: { after: 0 },
    ...opts,
    children: right ? [...left, new TextRun({ text: `\t${right}`, font: 'Arial', size: 20, color: MUTED })] : left,
  });
}

function bullet(text: string): Paragraph {
  return new Paragraph({
    numbering: { reference: 'resume-bullets', level: 0 },
    spacing: { after: 30 },
    children: [run(text)],
  });
}

const numbering = {
  config: [
    {
      reference: 'resume-bullets',
      levels: [
        {
          level: 0,
          format: LevelFormat.BULLET,
          text: '•',
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 300, hanging: 200 } } },
        },
      ],
    },
  ],
};

export async function resumeToDocx(doc: ResumeDoc, meta: { title: string }): Promise<Buffer> {
  const children: Paragraph[] = [];
  children.push(new Paragraph({ spacing: { after: 40 }, children: [run(doc.header.name, { bold: true, size: 36 })] }));
  if (doc.header.contact.length) children.push(new Paragraph({ spacing: { after: 60 }, children: [run(doc.header.contact.join('  |  '), { size: 18, color: MUTED })] }));
  for (const s of doc.sections) {
    children.push(sectionHeading(s.title));
    for (const it of s.items) {
      if (it.type === 'text') children.push(new Paragraph({ spacing: { after: 60 }, children: [run(it.text)] }));
      else if (it.type === 'skills') {
        for (const g of it.groups) children.push(new Paragraph({ spacing: { after: 30 }, children: [run(`${g.label}: `, { bold: true }), run(g.items.join(', '))] }));
      } else {
        children.push(twoColumn([run(it.heading, { bold: true })], it.location, { spacing: { before: 80 } }));
        if (it.subheading || it.dates) children.push(twoColumn([run(it.subheading, { italics: true })], it.dates));
        for (const b of it.bullets) children.push(bullet(b.text));
      }
    }
  }
  const document = new Document({
    creator: 'GetMeAJob',
    title: meta.title,
    description: 'Resume',
    numbering,
    styles: { default: { document: { run: { font: 'Arial', size: 20 } } } },
    sections: [{ properties: { page: { margin: { top: 720, bottom: 720, left: PAGE.margin, right: PAGE.margin } } }, children }],
  });
  return Packer.toBuffer(document);
}

export async function letterToDocx(input: { name: string; contact: string[]; date: string; greeting: string; paragraphs: string[]; closing: string; title: string }): Promise<Buffer> {
  const children: Paragraph[] = [
    new Paragraph({ spacing: { after: 40 }, children: [run(input.name, { bold: true, size: 32 })] }),
    new Paragraph({ spacing: { after: 360 }, children: [run(input.contact.join('  |  '), { size: 18, color: MUTED })] }),
    new Paragraph({ spacing: { after: 240 }, children: [run(input.date, { size: 21 })] }),
    new Paragraph({ spacing: { after: 200 }, children: [run(input.greeting, { size: 21 })] }),
    ...input.paragraphs.map((p) => new Paragraph({ spacing: { after: 200, line: 288 }, children: [run(p, { size: 21 })] })),
    new Paragraph({ spacing: { before: 80, after: 40 }, children: [run(input.closing, { size: 21 })] }),
    new Paragraph({ children: [run(input.name, { size: 21 })] }),
  ];
  const document = new Document({
    creator: 'GetMeAJob',
    title: input.title,
    styles: { default: { document: { run: { font: 'Arial', size: 21 } } } },
    sections: [{ properties: { page: { margin: { top: 1080, bottom: 1080, left: 1152, right: 1152 } } }, children }],
  });
  return Packer.toBuffer(document);
}

/* PDF -------------------------------------------------------------------------------------------- */

// Characters representable in the standard 14 fonts' WinAnsi encoding.
const WIN_ANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
const REPLACE: Record<string, string> = { '\u2192': '->', '\u2190': '<-', '\u2713': '', '\u2714': '', '\u2605': '*', '\u2010': '-', '\u2011': '-', '\u2012': '-', '\u2212': '-', '\u2009': ' ', '\u200b': '' };

export function toWinAnsi(text: string): string {
  let out = '';
  for (const ch of text.normalize('NFC')) {
    const code = ch.codePointAt(0)!;
    if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRA.has(ch)) out += ch;
    else if (REPLACE[ch] !== undefined) out += REPLACE[ch];
    else if (ch === '\n' || ch === '\t') out += ' ';
    else {
      const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
      out += /^[\x20-\x7e]+$/.test(base) ? base : '?';
    }
  }
  return out;
}

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
}

class PdfWriter {
  readonly pageWidth = 612;
  readonly pageHeight = 792;
  page!: PDFPage;
  y = 0;
  pages = 0;
  constructor(
    readonly pdf: PDFDocument,
    readonly fonts: Fonts,
    readonly margin: { x: number; top: number; bottom: number },
  ) {
    this.newPage();
  }
  get width() {
    return this.pageWidth - this.margin.x * 2;
  }
  newPage() {
    this.page = this.pdf.addPage([this.pageWidth, this.pageHeight]);
    this.y = this.pageHeight - this.margin.top;
    this.pages++;
  }
  ensure(h: number) {
    if (this.y - h < this.margin.bottom) this.newPage();
  }
  wrap(text: string, font: PDFFont, size: number, width: number): string[] {
    const words = toWinAnsi(text).split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let line = '';
    for (const w of words) {
      const candidate = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(candidate, size) <= width || !line) line = candidate;
      else {
        lines.push(line);
        line = w;
      }
    }
    if (line) lines.push(line);
    return lines;
  }
  text(t: string, x: number, size: number, font: PDFFont, color = rgb(0.12, 0.16, 0.22)) {
    this.page.drawText(toWinAnsi(t), { x, y: this.y, size, font, color });
  }
  rightText(t: string, size: number, font: PDFFont, color = rgb(0.29, 0.33, 0.39)) {
    const s = toWinAnsi(t);
    this.page.drawText(s, { x: this.margin.x + this.width - font.widthOfTextAtSize(s, size), y: this.y, size, font, color });
  }
}

function layoutResume(w: PdfWriter, doc: ResumeDoc, size: number): void {
  const { regular, bold, italic } = w.fonts;
  const lh = size * 1.28;
  const x0 = w.margin.x;
  const muted = rgb(0.29, 0.33, 0.39);
  w.y -= 18;
  w.text(doc.header.name, x0, 18, bold);
  w.y -= 15;
  if (doc.header.contact.length) {
    for (const line of w.wrap(doc.header.contact.join('  |  '), regular, size - 1, w.width)) {
      w.text(line, x0, size - 1, regular, muted);
      w.y -= lh;
    }
  }
  for (const s of doc.sections) {
    w.ensure(lh * 4);
    w.y -= size * 0.9;
    w.text(s.title, x0, size + 1, bold);
    w.y -= 4;
    w.page.drawLine({ start: { x: x0, y: w.y }, end: { x: x0 + w.width, y: w.y }, thickness: 0.6, color: rgb(0.6, 0.64, 0.69) });
    w.y -= lh;
    for (const it of s.items) {
      if (it.type === 'text') {
        for (const line of w.wrap(it.text, regular, size, w.width)) {
          w.ensure(lh);
          w.text(line, x0, size, regular);
          w.y -= lh;
        }
        w.y -= 2;
      } else if (it.type === 'skills') {
        for (const g of it.groups) {
          const label = `${g.label}: `;
          const labelW = bold.widthOfTextAtSize(toWinAnsi(label), size);
          const lines = w.wrap(g.items.join(', '), regular, size, w.width - labelW);
          w.ensure(lh);
          w.text(label, x0, size, bold);
          lines.forEach((line, i) => {
            if (i > 0) w.ensure(lh);
            w.text(line, x0 + labelW, size, regular);
            w.y -= lh;
          });
        }
      } else {
        w.ensure(lh * 3);
        w.y -= 2;
        w.text(it.heading, x0, size, bold);
        if (it.location) w.rightText(it.location, size, regular, muted);
        w.y -= lh;
        if (it.subheading || it.dates) {
          const subLines = w.wrap(it.subheading, italic, size, w.width - (it.dates ? regular.widthOfTextAtSize(toWinAnsi(it.dates), size) + 16 : 0));
          subLines.forEach((line, i) => {
            w.text(line, x0, size, italic);
            if (i === 0 && it.dates) w.rightText(it.dates, size, regular, muted);
            w.y -= lh;
          });
          if (!subLines.length && it.dates) {
            w.rightText(it.dates, size, regular, muted);
            w.y -= lh;
          }
        }
        for (const b of it.bullets) {
          const lines = w.wrap(b.text, regular, size, w.width - 12);
          lines.forEach((line, i) => {
            w.ensure(lh);
            if (i === 0) w.text('•', x0 + 2, size, regular);
            w.text(line, x0 + 12, size, regular);
            w.y -= lh;
          });
        }
      }
    }
  }
}

async function newPdf(title: string, author: string) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(title);
  pdf.setAuthor(author);
  pdf.setCreator('GetMeAJob');
  pdf.setProducer('GetMeAJob');
  const fonts: Fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    italic: await pdf.embedFont(StandardFonts.HelveticaOblique),
  };
  return { pdf, fonts };
}

/** Render the resume, shrinking type slightly (never below 9.2pt) to keep a one-page resume on one page. */
export async function resumeToPdf(doc: ResumeDoc, meta: { title: string }): Promise<{ bytes: Uint8Array; pages: number; fontSize: number }> {
  let last: { bytes: Uint8Array; pages: number; fontSize: number } | null = null;
  for (const size of [10.5, 10, 9.6, 9.2]) {
    const { pdf, fonts } = await newPdf(meta.title, doc.header.name);
    const w = new PdfWriter(pdf, fonts, { x: 43, top: 40, bottom: 40 });
    layoutResume(w, doc, size);
    last = { bytes: await pdf.save(), pages: w.pages, fontSize: size };
    if (w.pages === 1) return last;
  }
  // Content genuinely needs two pages: render at a comfortable size.
  const { pdf, fonts } = await newPdf(meta.title, doc.header.name);
  const w = new PdfWriter(pdf, fonts, { x: 43, top: 40, bottom: 40 });
  layoutResume(w, doc, 10);
  return { bytes: await pdf.save(), pages: w.pages, fontSize: 10 };
}

export async function letterToPdf(input: { name: string; contact: string[]; date: string; greeting: string; paragraphs: string[]; closing: string; title: string }): Promise<Uint8Array> {
  const { pdf, fonts } = await newPdf(input.title, input.name);
  const w = new PdfWriter(pdf, fonts, { x: 72, top: 64, bottom: 64 });
  const size = 10.5;
  const lh = size * 1.45;
  const x0 = w.margin.x;
  w.y -= 16;
  w.text(input.name, x0, 16, fonts.bold);
  w.y -= 15;
  for (const line of w.wrap(input.contact.join('  |  '), fonts.regular, 9, w.width)) {
    w.text(line, x0, 9, fonts.regular, rgb(0.29, 0.33, 0.39));
    w.y -= 12;
  }
  w.y -= 22;
  const para = (text: string, after = lh) => {
    for (const line of w.wrap(text, fonts.regular, size, w.width)) {
      w.ensure(lh);
      w.text(line, x0, size, fonts.regular);
      w.y -= lh;
    }
    w.y -= after - lh + 6;
  };
  para(input.date);
  para(input.greeting);
  for (const p of input.paragraphs) para(p);
  para(input.closing, lh);
  para(input.name);
  return pdf.save();
}
