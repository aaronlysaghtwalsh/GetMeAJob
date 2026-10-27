import type { App } from '../../app';
import { nowIso } from '../../lib/ids';
import { INTEGRITY_CHARTER, UNTRUSTED_NOTE, asData } from '../../ai/prompts';
import { AnswerIntegrationSchema, DiscoveryPlanSchema, type EvidenceSource, type QuestionDTO } from '../../../shared/schemas/brain';
import { normalizeDate, unsupportedNumbers } from '../../../shared/text';
import * as brainRepo from '../../repos/brain';
import { getPreferences } from '../../repos/preferences';
import { buildBrainContext, preferencesText } from './context';

const DISCOVERY_SYSTEM = `${INTEGRITY_CHARTER}

Task: act as an expert recruiter interviewing the applicant to strengthen their Career Brain. Resumes rarely contain everything; your questions uncover the evidence that will make applications stronger.

Choose the highest-value questions first:
- Quantify impact in the strongest roles (volumes, frequency, audience size, results, before/after).
- Uncover customer-facing, stakeholder, sales, leadership, presentation and problem-solving specifics that recruiters for the applicant's target roles look for.
- Fill gaps that make a role hard to understand (what the organization does, who the applicant served, tools used).
- Ask about accomplishments that are implied but not stated, without assuming they happened.
Do NOT ask about work authorization, salary, location or availability: those are collected in a separate preferences form.
Do NOT repeat questions already asked (listed below) unless the answer created a clear follow-up.

Write each question so it is easy to answer in one or two sentences, names the specific role or project, and asks for one thing. Return at most 8 questions, ordered by value. Set readyForApplications to true when the evidence is already strong enough to produce competitive applications.
${UNTRUSTED_NOTE}`;

export async function generateDiscovery(app: App, userId: string, opts: { taskId?: string; signal?: AbortSignal }): Promise<{ created: number; summary: string; ready: boolean }> {
  const brain = brainRepo.getBrain(app.db, userId);
  if (!brain.experiences.length && !brain.evidence.length && !brain.education.length) return { created: 0, summary: '', ready: false };
  const ctx = buildBrainContext(brain, 'all');
  const prefs = getPreferences(app.db, userId);
  const asked = app.db
    .all<{ question: string; answer: string | null; status: string }>(`SELECT question, answer, status FROM discovery_questions WHERE user_id = ? ORDER BY created_at DESC LIMIT 60`, [userId])
    .map((q) => `- ${q.question}${q.status === 'answered' ? ` (answered: ${String(q.answer).slice(0, 200)})` : ` (${q.status})`}`)
    .join('\n');

  const plan = await app.ai.structured({
    userId,
    taskId: opts.taskId,
    task: 'discovery',
    purpose: 'Plan discovery questions',
    context: `${ctx.text}\n\n${preferencesText(prefs)}`,
    system: DISCOVERY_SYSTEM,
    prompt: `Questions already asked:\n${asked || '(none)'}\n\nPlan the next discovery questions.`,
    schema: DiscoveryPlanSchema,
    schemaName: 'discovery_plan',
    signal: opts.signal,
  });

  let created = 0;
  app.db.tx(() => {
    // Replace unanswered AI questions (but keep conflict questions, which come from document comparison).
    app.db.run(`UPDATE discovery_questions SET status = 'dismissed' WHERE user_id = ? AND status = 'open' AND category != 'conflict'`, [userId]);
    for (const q of plan.questions.slice(0, 8)) {
      if (['preferences', 'work_authorization', 'availability'].includes(q.category)) continue;
      const targetId = q.targetRef ? (ctx.refs.id(q.targetRef) ?? null) : null;
      brainRepo.insertQuestion(app.db, userId, {
        question: q.question,
        rationale: q.rationale,
        category: q.category,
        priority: q.priority,
        targetType: brainRepo.subjectTypeOf(app.db, userId, targetId) ?? 'general',
        targetId,
        answerType: q.answerType,
        choices: q.choices,
      });
      created++;
    }
  });
  return { created, summary: plan.summary, ready: plan.readyForApplications };
}

const ANSWER_SYSTEM = `${INTEGRITY_CHARTER}

Task: the applicant answered a discovery question. Convert the answer into Career Brain updates.
- newEvidence: one item per distinct fact the applicant stated. Use their words and numbers exactly; do not add outcomes, adjectives or numbers they did not state. "excerpt" must be copied from the answer.
- fieldUpdates: only when the question was about a conflict or a missing field (dates, titles, organization) and the answer clearly resolves it.
- If the answer is "no", "not really" or adds nothing factual, return empty lists.
- followUp: only when one specific detail would clearly make the new evidence much stronger (for example a number they mentioned vaguely).
${UNTRUSTED_NOTE}`;

export async function integrateAnswer(
  app: App,
  userId: string,
  questionId: string,
  opts: { taskId?: string; signal?: AbortSignal },
): Promise<{ evidenceCreated: number; fieldsUpdated: number; followUp: string }> {
  const row = app.db.one<Record<string, any>>('SELECT * FROM discovery_questions WHERE id = ? AND user_id = ?', [questionId, userId]);
  if (!row || !row.answer) throw new Error('Question or answer not found');
  const q: QuestionDTO = brainRepo.toQuestion(row);
  const brain = brainRepo.getBrain(app.db, userId);
  const ctx = buildBrainContext(brain, 'all');
  const targetRef = q.targetId ? ctx.refs.ref(q.targetId) : undefined;

  const out = await app.ai.structured({
    userId,
    taskId: opts.taskId,
    task: 'answer_integration',
    purpose: 'Add discovery answer to Career Brain',
    context: ctx.text,
    system: ANSWER_SYSTEM,
    prompt: `Question${targetRef ? ` (about ${targetRef})` : ''}: ${q.question}\nCategory: ${q.category}\n\n${asData('answer', q.answer!)}`,
    schema: AnswerIntegrationSchema,
    schemaName: 'answer_integration',
    signal: opts.signal,
  });

  const answer = q.answer!;
  let evidenceCreated = 0;
  let fieldsUpdated = 0;
  app.db.tx(() => {
    for (const e of out.newEvidence) {
      // Integrity: every number must come from the applicant's answer.
      if (unsupportedNumbers(e.statement, [answer]).length) continue;
      const subjectId = e.subjectRef ? (ctx.refs.id(e.subjectRef) ?? q.targetId) : q.targetId;
      const subjectType = brainRepo.subjectTypeOf(app.db, userId, subjectId ?? null) ?? 'general';
      const source: EvidenceSource = { type: 'answer', questionId, excerpt: (e.excerpt || answer).slice(0, 600) };
      const id = brainRepo.insertEvidence(app.db, userId, {
        statement: e.statement,
        kind: e.kind,
        subjectType,
        subjectId: subjectType === 'general' ? null : (subjectId ?? null),
        metrics: e.metrics.filter((m) => unsupportedNumbers(m.value, [answer]).length === 0),
        skills: e.skills,
        themes: e.themes,
        provenance: 'applicant_provided',
        sources: [source],
        userConfirmed: true,
      });
      for (const s of e.skills) brainRepo.upsertSkill(app.db, userId, { name: s, category: 'technical', provenance: 'applicant_provided', evidenceIds: [id] });
      evidenceCreated++;
    }
    for (const s of out.newSkills) brainRepo.upsertSkill(app.db, userId, { name: s.name, category: s.category, provenance: 'applicant_provided', sources: [{ type: 'answer', questionId, excerpt: answer.slice(0, 300) }] });
    for (const u of out.fieldUpdates) {
      const id = ctx.refs.id(u.targetRef) ?? q.targetId;
      if (!id) continue;
      if (id.startsWith('exp_')) {
        const col: Record<string, string> = { organization: 'organization', title: 'title', startDate: 'start_date', endDate: 'end_date', isCurrent: 'is_current', location: 'location' };
        const c = col[u.field];
        if (!c) continue;
        const value = u.field === 'isCurrent' ? (u.value === 'true' ? 1 : 0) : u.field.endsWith('Date') ? normalizeDate(u.value) : u.value;
        app.db.run(`UPDATE experiences SET ${c} = ?, provenance = 'applicant_provided', updated_at = ? WHERE id = ? AND user_id = ?`, [value, nowIso(), id, userId]);
        if (u.field === 'endDate' && value) app.db.run(`UPDATE experiences SET is_current = 0 WHERE id = ? AND user_id = ?`, [id, userId]);
        fieldsUpdated++;
      } else if (id.startsWith('edu_')) {
        const col: Record<string, string> = { startDate: 'start_date', endDate: 'end_date', degree: 'degree', grade: 'grade', location: 'location', organization: 'institution' };
        const c = col[u.field];
        if (!c) continue;
        const value = u.field.endsWith('Date') ? normalizeDate(u.value) : u.value;
        app.db.run(`UPDATE education SET ${c} = ?, provenance = 'applicant_provided', updated_at = ? WHERE id = ? AND user_id = ?`, [value, nowIso(), id, userId]);
        fieldsUpdated++;
      }
    }
    app.db.run(`UPDATE discovery_questions SET applied = ? WHERE id = ?`, [JSON.stringify({ evidenceCreated, fieldsUpdated }), questionId]);
    if (out.followUp.trim()) {
      brainRepo.insertQuestion(app.db, userId, {
        question: out.followUp.trim(),
        rationale: 'A follow-up on your last answer. One concrete detail here makes that evidence much stronger.',
        category: q.category,
        priority: Math.max(1, q.priority - 5),
        targetType: q.targetType,
        targetId: q.targetId,
        answerType: 'text',
        choices: [],
      });
    }
  });
  return { evidenceCreated, fieldsUpdated, followUp: out.followUp };
}
