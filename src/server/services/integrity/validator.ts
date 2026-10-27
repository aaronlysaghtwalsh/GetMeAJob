import type { CareerBrainDTO, EvidenceDTO } from '../../../shared/schemas/brain';
import type { IntegrityIssue, IntegrityReport } from '../../../shared/schemas/documents';
import type { ResearchContent } from '../../../shared/schemas/research';
import { USABLE_PROVENANCE } from '../../../shared/constants';
import { extractNumbers, normalizeName, unsupportedNumbers } from '../../../shared/text';

/**
 * Common tools/technologies. If one appears in generated text, it must be supported by cited evidence or
 * the Career Brain. Ambiguous words (Excel, Spark, Workday...) are matched case-sensitively so ordinary
 * English ("excel at", "during the workday") is not flagged.
 */
const KNOWN_TOOLS: { term: string; exact?: boolean }[] = [
  ...['python', 'sql', 'power bi', 'tableau', 'looker', 'salesforce', 'hubspot', 'jira', 'aws', 'azure', 'gcp', 'google cloud', 'java', 'javascript', 'typescript', 'react', 'node.js', 'c++', 'kotlin', 'docker', 'kubernetes', 'terraform', 'snowflake', 'databricks', 'hadoop', 'pandas', 'numpy', 'scikit-learn', 'tensorflow', 'pytorch', 'zendesk', 'gainsight', 'marketo', 'google analytics', 'figma', 'linux', 'splunk', 'servicenow', 'netsuite', 'quickbooks', 'alteryx', 'spss', 'stata', 'matlab', 'airflow', 'power automate', 'sharepoint', 'microsoft excel', 'vba'].map((term) => ({ term })),
  ...['Excel', 'Spark', 'SAP', 'SAS', 'Oracle', 'Workday', 'Okta', 'Git', 'dbt', 'Swift'].map((term) => ({ term, exact: true })),
];

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function mentions(text: string, term: string, exact = false): boolean {
  return new RegExp(`(^|[^A-Za-z0-9])${escapeRe(exact ? term : term.toLowerCase())}(?![A-Za-z0-9])`, exact ? '' : 'i').test(exact ? text : text.toLowerCase());
}

export interface IntegrityContext {
  brain: CareerBrainDTO;
  research?: ResearchContent | null;
  /** Extra texts that may legitimately support numbers (e.g. the job posting for company facts). */
  companyTexts?: string[];
  /** Name of the target company (allowed in text). */
  companyName?: string;
}

export class IntegrityChecker {
  private evidence = new Map<string, EvidenceDTO>();
  private recordText = new Map<string, string>();
  private skillNames: Set<string>;
  private brainToolSupport: string;

  constructor(private ctx: IntegrityContext) {
    for (const e of ctx.brain.evidence) this.evidence.set(e.id, e);
    for (const x of ctx.brain.experiences) this.recordText.set(x.id, `${x.title} ${x.organization} ${x.location} ${x.startDate} ${x.endDate} ${x.summary}`);
    for (const d of ctx.brain.education)
      this.recordText.set(d.id, `${d.degree} ${d.field} ${d.minor} ${d.institution} ${d.location} ${d.startDate} ${d.endDate} ${d.grade} ${d.coursework.join(' ')} ${d.honors.join(' ')}`);
    for (const p of ctx.brain.projects) this.recordText.set(p.id, `${p.name} ${p.context} ${p.role} ${p.summary} ${p.technologies.join(' ')} ${p.startDate} ${p.endDate}`);
    const usableSkills = ctx.brain.skills.filter((s) => !s.hidden && USABLE_PROVENANCE.includes(s.provenance));
    this.skillNames = new Set(usableSkills.map((s) => normalizeName(s.name)));
    this.brainToolSupport = [
      ...usableSkills.map((s) => s.name),
      ...ctx.brain.evidence.filter((e) => !e.hidden && USABLE_PROVENANCE.includes(e.provenance)).flatMap((e) => [e.statement, ...e.skills]),
      ...ctx.brain.projects.flatMap((p) => p.technologies),
    ].join(' \n ');
  }

  isUsableEvidence(id: string): boolean {
    const e = this.evidence.get(id);
    return !!e && !e.hidden && USABLE_PROVENANCE.includes(e.provenance);
  }

  /** Texts that support a claim citing these ids (evidence statements, metrics, source quotes, record headers). */
  supportFor(ids: string[]): string[] {
    const out: string[] = [];
    for (const id of ids) {
      const e = this.evidence.get(id);
      if (e) {
        out.push(e.statement, ...e.metrics.map((m) => `${m.value} ${m.unit}`), ...e.skills);
        for (const s of e.sources) {
          if (s.type === 'document') out.push(s.quote);
          if (s.type === 'answer') out.push(s.excerpt);
        }
        if (e.subjectId && this.recordText.has(e.subjectId)) out.push(this.recordText.get(e.subjectId)!);
      }
      const rec = this.recordText.get(id);
      if (rec) out.push(rec);
    }
    return out;
  }

  findingSupport(findingIds: string[]): string[] {
    const findings = this.ctx.research?.findings ?? [];
    const sources = this.ctx.research?.sources ?? [];
    const out: string[] = [];
    for (const id of findingIds) {
      const f = findings.find((x) => x.id === id);
      if (!f) continue;
      out.push(f.claim);
      for (const sid of f.sourceIds) {
        const s = sources.find((x) => x.id === sid);
        if (s?.snippet) out.push(s.snippet);
      }
    }
    return out;
  }

  isKnownSkill(name: string): boolean {
    return this.skillNames.has(normalizeName(name));
  }

  /**
   * Check one generated claim.
   * - evidenceIds: what the claim cites (evidence or record ids)
   * - requireEvidence: claims about the applicant must cite something
   * - findingIds: research findings cited for company statements
   */
  checkClaim(
    text: string,
    opts: { evidenceIds: string[]; findingIds?: string[]; location: string; requireEvidence?: boolean; allowCompanyNumbers?: boolean },
    issues: IntegrityIssue[],
  ): void {
    const cited = opts.evidenceIds;
    for (const id of cited) {
      if (id.startsWith('evd_') && !this.isUsableEvidence(id)) {
        const e = this.evidence.get(id);
        issues.push({
          severity: 'blocker',
          code: 'unusable_evidence',
          location: opts.location,
          text,
          message: e ? `Cites evidence that is ${e.hidden ? 'hidden' : e.provenance} and cannot be used: "${e.statement.slice(0, 80)}"` : 'Cites evidence that no longer exists.',
        });
      }
    }
    if (opts.requireEvidence && cited.length === 0 && extractNumbers(text).length + this.toolMentions(text).length > 0) {
      issues.push({ severity: 'blocker', code: 'no_evidence', location: opts.location, text, message: 'Makes a specific claim without citing any evidence.' });
    }
    const support = [...this.supportFor(cited), ...this.findingSupport(opts.findingIds ?? [])];
    if (opts.allowCompanyNumbers) support.push(...(this.ctx.companyTexts ?? []));
    const bad = unsupportedNumbers(text, support);
    if (bad.length) {
      issues.push({
        severity: 'blocker',
        code: 'unsupported_number',
        location: opts.location,
        text,
        message: `Contains ${bad.length === 1 ? 'a number' : 'numbers'} not found in the cited evidence: ${bad.map((b) => b.raw).join(', ')}`,
      });
    }
    const supportText = support.join(' \n ');
    for (const tool of this.toolMentions(text)) {
      const inCited = mentions(supportText, tool.term, false);
      const inBrain = mentions(this.brainToolSupport, tool.term, false);
      if (!inCited && !inBrain) {
        issues.push({ severity: 'blocker', code: 'unknown_skill', location: opts.location, text, message: `Mentions "${tool.term}", which is not in your Career Brain.` });
      } else if (!inCited && cited.length) {
        issues.push({ severity: 'warning', code: 'unknown_skill', location: opts.location, text, message: `Mentions "${tool.term}", which the cited evidence does not mention (it is elsewhere in your Career Brain).` });
      }
    }
  }

  private toolMentions(text: string): { term: string; exact?: boolean }[] {
    const company = normalizeName(this.ctx.companyName ?? '');
    return KNOWN_TOOLS.filter((t) => !(company && company.includes(normalizeName(t.term))) && mentions(text, t.term, t.exact));
  }
}

export function report(issues: IntegrityIssue[], checkedClaims: number): IntegrityReport {
  return { ok: !issues.some((i) => i.severity === 'blocker'), checkedClaims, issues };
}
