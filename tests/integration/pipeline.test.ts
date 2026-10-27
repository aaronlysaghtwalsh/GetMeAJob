import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Client, startTestServer, type TestServer } from '../helpers';
import { JOB_POSTING, JOB_QUESTIONS, resumeADocx, resumeBPdf } from '../fixtures/persona';

let srv: TestServer;
let c: Client;
let appId = '';

before(async () => {
  srv = await startTestServer();
  c = new Client(srv.url);
});
after(async () => {
  await srv.close();
});

test('sign up', async () => {
  const r = await c.post('/api/auth/signup', { email: 'jordan@example.com', password: 'a long passphrase here', displayName: 'Jordan' });
  assert.equal(r.status, 201);
  assert.ok(c.cookie.startsWith('gmaj_session='));
});

test('upload two resumes and build the Career Brain', async () => {
  const form = new FormData();
  form.append('kind', 'resume');
  form.append('files', new Blob([new Uint8Array(await resumeADocx())]), 'jordan-analytics.docx');
  form.append('files', new Blob([new Uint8Array(await resumeBPdf())]), 'jordan-client.pdf');
  const up = await c.post('/api/documents', form);
  assert.equal(up.status, 201, JSON.stringify(up.data));
  assert.equal(up.data.documentIds.length, 2);
  const task = await c.waitTask(up.data.task.id);
  assert.equal(task.status, 'succeeded', task.error);

  const { data } = await c.get('/api/brain');
  const brain = data.brain;
  // Same role across two resumes is consolidated into one record with two sources.
  const lakeshore = brain.experiences.filter((x: any) => /Lakeshore/.test(x.organization));
  assert.equal(lakeshore.length, 1, 'Lakeshore internship merged');
  assert.equal(lakeshore[0].sources.length, 2);
  assert.equal(lakeshore[0].provenance, 'verified');
  assert.equal(brain.experiences.length, 4, 'Lakeshore, Campus Rec, Fizzwell, Soccer');
  // Evidence: quotes verified against the original documents.
  assert.ok(brain.stats.verified >= 10, `verified evidence: ${brain.stats.verified}`);
  const rows = brain.evidence.find((e: any) => /250,000\+/.test(e.statement));
  assert.ok(rows, 'merged evidence keeps the more precise statement');
  assert.equal(rows.sources.length, 2);
  assert.equal(brain.evidence.filter((e: any) => /250/.test(e.statement)).length, 1, 'duplicate evidence merged');
  assert.ok(brain.skills.some((s: any) => s.name === 'Tableau'));
  assert.ok(brain.resumeSources.length === 2, 'both resumes kept as representations');
  assert.equal(brain.profile.fullName, 'Jordan Rivera');
  // The conflicting Campus Rec end date becomes a question; discovery questions follow.
  const qs = await c.get('/api/brain/questions');
  assert.ok(qs.data.open.some((q: any) => q.category === 'conflict'), 'conflict question created');
  assert.ok(qs.data.open.length >= 3);
});

test('answer the conflict question and update the record', async () => {
  const qs = await c.get('/api/brain/questions');
  const conflict = qs.data.open.find((q: any) => q.category === 'conflict');
  const r = await c.post(`/api/brain/questions/${conflict.id}/answer`, { answer: 'It ended in May 2025.' });
  assert.equal(r.status, 202);
  const t = await c.waitTask(r.data.task.id);
  assert.equal(t.status, 'succeeded', t.error);
  const { data } = await c.get('/api/brain');
  const campus = data.brain.experiences.find((x: any) => /Campus Rec/.test(x.organization));
  assert.equal(campus.endDate, '2025-05');
  assert.equal(campus.provenance, 'applicant_provided');
});

test('answer a discovery question creates applicant-provided evidence (numbers must come from the answer)', async () => {
  const qs = await c.get('/api/brain/questions');
  const q = qs.data.open.find((x: any) => /typical Fizzwell event/.test(x.question));
  const r = await c.post(`/api/brain/questions/${q.id}/answer`, { answer: 'Usually around 150 people per event.' });
  await c.waitTask(r.data.task.id);
  const { data } = await c.get('/api/brain');
  const ev = data.brain.evidence.find((e: any) => /150 people/.test(e.statement));
  assert.ok(ev, 'evidence added');
  assert.equal(ev.provenance, 'applicant_provided');
  assert.equal(ev.sources[0].type, 'answer');
});

test('preferences and readiness', async () => {
  const before = await c.get('/api/brain/readiness');
  assert.ok(before.data.requiredRemaining > 0);
  const prefs = (await c.get('/api/preferences')).data;
  const r = await c.put('/api/preferences', {
    ...prefs,
    targetRoles: ['Customer Insights Analyst', 'Data Analyst'],
    locations: ['Chicago, IL'],
    workModels: ['hybrid', 'onsite'],
    compensation: { ...prefs.compensation, minimum: 65000, target: 75000 },
    workAuthorization: { ...prefs.workAuthorization, authorizedToWork: 'yes', requiresSponsorshipNow: 'no', requiresSponsorshipFuture: 'no' },
    availability: { ...prefs.availability, availableFrom: '2026-06' },
  });
  assert.equal(r.status, 200);
  const after = await c.get('/api/brain/readiness');
  assert.equal(after.data.requiredRemaining, 0, JSON.stringify(after.data.items.filter((i: any) => i.status !== 'done')));
});

test('create an application from a pasted job and run the full pipeline', async () => {
  const r = await c.post('/api/applications', { mode: 'paste', text: JOB_POSTING, questions: JOB_QUESTIONS, researchDepth: 'deep' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  appId = r.data.applicationId;
  assert.equal(r.data.imported.questions, 3);
  const t = await c.waitTask(r.data.task.id, 60_000);
  assert.equal(t.status, 'succeeded', t.error);
  assert.ok(t.progress.steps.every((s: any) => s.status === 'done'), JSON.stringify(t.progress.steps));

  const { data } = await c.get(`/api/applications/${appId}`);
  assert.equal(data.job.intelligence.requirements.length, 8);
  // Research: facts cite real sources.
  const research = data.artifacts.research.content;
  assert.ok(research.webSearchUsed);
  assert.ok(research.findings.filter((f: any) => f.type === 'fact').every((f: any) => f.sourceIds.length > 0));
  assert.ok(research.sources.some((s: any) => s.url.includes('northwind-analytics.example')));
  // Fit: computed scores + tier.
  const fit = data.artifacts.fit.content;
  assert.equal(fit.finalTier, 'high_priority');
  assert.ok(fit.scores.overall > 60 && fit.scores.overall <= 100);
  assert.equal(fit.requirementMatches.length, 8);
  assert.ok(fit.requirementMatches[1].evidenceIds[0].startsWith('evd_'), 'refs mapped to ids');
  // Strategy references real resume sources.
  const strategy = data.artifacts.strategy.content;
  assert.equal(strategy.baseResume.decision, 'combine');
  assert.equal(strategy.baseResume.sourceIds.length, 2);
  // Resume: integrity checked, unsupported skill removed, rendered and ATS-analyzed.
  const resume = data.artifacts.resume.content;
  assert.equal(resume.integrity.ok, true, JSON.stringify(resume.integrity.issues));
  assert.ok(resume.integrity.issues.some((i: any) => i.text === 'Salesforce' && i.code === 'unknown_skill'), 'Salesforce removed');
  assert.ok(resume.integrity.issues.some((i: any) => /Fixed automatically/.test(i.message) && /two years/.test(i.text)), 'embellishment caught and repaired');
  assert.ok(resume.plainText.includes('brand ambassador') && !resume.plainText.includes('two years'));
  assert.ok(!resume.plainText.includes('Salesforce'));
  assert.ok(resume.plainText.includes('Lakeshore Retail Group'));
  assert.ok(resume.ats.score >= 70, `ATS ${resume.ats.score}`);
  assert.ok(resume.ats.parsed.every((p: any) => p.ok && p.detectedName && p.detectedEmail), JSON.stringify(resume.ats.parsed));
  // Cover letter + answers.
  const letter = data.artifacts.cover_letter.content;
  assert.equal(letter.integrity.ok, true, JSON.stringify(letter.integrity.issues));
  assert.ok(letter.wordCount > 150);
  assert.equal(data.questions.length, 3);
  const sponsor = data.questions.find((q: any) => /sponsorship/i.test(q.question));
  assert.equal(sponsor.sensitive, true);
  assert.ok(sponsor.answer.content.integrity.issues.some((i: any) => i.code === 'sensitive_review'));
  const why = data.questions.find((q: any) => /Why are you interested/.test(q.question));
  assert.equal(why.limitType, 'words');
  assert.equal(why.limitValue, 150);
  assert.ok(why.answer.content.wordCount <= 150);
  // Review.
  const review = data.artifacts.review.content;
  assert.ok(review.overall > 50);
  assert.ok(review.recommendations.some((x: any) => x.applicable));
  assert.equal(data.application.stage, 'preparing');
});

test('large-schema tasks put the schema in the prompt instead of using native structured outputs', () => {
  // Guards the 7 Oct 2026 live-API fix: the Anthropic API rejected these schemas as too large.
  const calls = srv.app.ai.scriptedProvider!.calls;
  const promptSchema = ['career_extraction', 'job_intelligence', 'company_research', 'fit_analysis', 'application_strategy'];
  for (const name of promptSchema) {
    const call = calls.find((x) => x.name === name);
    assert.ok(call, `${name} was called`);
    assert.equal(call.req.jsonSchema, undefined, `${name} must not send a native schema`);
    assert.equal(call.req.schemaName, name);
    assert.ok(call.req.system.some((s) => s.text.includes('Respond with ONLY a JSON object')), `${name} has the schema in its instructions`);
  }
  // Other structured tasks still use native structured outputs.
  const resume = calls.find((x) => x.name === 'resume_draft');
  assert.ok(resume?.req.jsonSchema, 'resume uses native structured outputs');
});

test('downloads render real files', async () => {
  const { data } = await c.get(`/api/applications/${appId}`);
  const pdf = await c.get(`/api/artifacts/${data.artifacts.resume.id}/download?format=pdf`);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  assert.equal(Buffer.from(pdf.data).subarray(0, 5).toString(), '%PDF-');
  const docx = await c.get(`/api/artifacts/${data.artifacts.cover_letter.id}/download?format=docx`);
  assert.equal(docx.status, 200);
  assert.equal(Buffer.from(docx.data).subarray(0, 2).toString(), 'PK');
});

test('accepting a review recommendation creates a new resume version', async () => {
  const { data } = await c.get(`/api/applications/${appId}`);
  const review = data.artifacts.review;
  const rec = review.content.recommendations.find((x: any) => x.applicable);
  const r = await c.post(`/api/artifacts/${review.id}/recommendations/${rec.id}`, { decision: 'accepted' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(r.data.newArtifactId);
  const after = await c.get(`/api/applications/${appId}`);
  assert.equal(after.data.artifacts.resume.version, 2);
  assert.ok(after.data.artifacts.resume.content.plainText.includes(rec.replace));
  assert.equal(after.data.versions.resume.length, 2, 'previous version kept');
});

test('user edits are integrity-checked: an invented number is flagged and blocks approval', async () => {
  const { data } = await c.get(`/api/applications/${appId}`);
  const resume = data.artifacts.resume;
  const draft = structuredClone(resume.content.draft);
  draft.experience[0].bullets[0].text = 'Analyzed 900,000 rows of sales data and cut reporting time by 50%';
  const r = await c.post(`/api/artifacts/${resume.id}/revise`, { resume: draft, summary: 'Test edit' });
  assert.equal(r.status, 201);
  assert.equal(r.data.content.integrity.ok, false);
  assert.ok(r.data.content.integrity.issues.some((i: any) => i.code === 'unsupported_number'));
  const approve = await c.post(`/api/artifacts/${r.data.id}/approve`);
  assert.equal(approve.status, 409);
});

test('submission requires explicit approvals, then tracks the application', async () => {
  const blocked = await c.post(`/api/applications/${appId}/submit`, { confirm: true });
  assert.equal(blocked.status, 409);
  const { data } = await c.get(`/api/applications/${appId}`);
  // Approve the clean resume version (v2), cover letter and every answer.
  const resumeV2 = (await c.get(`/api/applications/${appId}/versions/resume`)).data.versions.find((v: any) => v.version === 2);
  assert.equal((await c.post(`/api/artifacts/${resumeV2.id}/approve`)).status, 200);
  assert.equal((await c.post(`/api/artifacts/${data.artifacts.cover_letter.id}/approve`)).status, 200);
  for (const q of data.questions) {
    if (q.sensitive) {
      // Sensitive answers cannot be approved with a single click: the applicant must confirm they checked it.
      const plain = await c.post(`/api/artifacts/${q.answer.id}/approve`);
      assert.equal(plain.status, 409);
      assert.equal(plain.data.error.code, 'sensitive_confirmation_required');
      assert.equal((await c.post(`/api/artifacts/${q.answer.id}/approve`, { confirmSensitive: true })).status, 200);
    } else {
      assert.equal((await c.post(`/api/artifacts/${q.answer.id}/approve`)).status, 200);
    }
  }
  const ok = await c.post(`/api/applications/${appId}/submit`, { confirm: true });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.stage, 'applied');
  assert.ok(ok.data.dateApplied);
  assert.ok(ok.data.nextActionDate, 'follow-up scheduled');
  const dash = await c.get('/api/dashboard');
  assert.equal(dash.data.metrics.totalApplied, 1);
  assert.equal(dash.data.metrics.interviewRate, null, 'no rate claimed from 1 application');
  const moved = await c.patch(`/api/applications/${appId}`, { stage: 'recruiter_screen' });
  assert.equal(moved.data.stage, 'recruiter_screen');
  const events = (await c.get(`/api/applications/${appId}`)).data.events;
  assert.ok(events.some((e: any) => e.title === 'Moved to Recruiter screen'));
});

test('sponsorship guardrail: a "no sponsorship" posting is flagged Do not apply and the build stops', async () => {
  const prefs = (await c.get('/api/preferences')).data;
  await c.put('/api/preferences', { ...prefs, workAuthorization: { ...prefs.workAuthorization, requiresSponsorshipNow: 'yes' } });
  const r = await c.post('/api/applications', { mode: 'paste', text: JOB_POSTING, questions: '', researchDepth: 'standard' });
  const t = await c.waitTask(r.data.task.id, 60_000);
  assert.equal(t.status, 'succeeded');
  assert.deepEqual(t.result.stoppedAt, 'fit');
  const { data } = await c.get(`/api/applications/${r.data.applicationId}`);
  assert.equal(data.artifacts.fit.content.finalTier, 'do_not_apply');
  assert.ok(data.artifacts.fit.content.guardrails.some((g: any) => g.rule === 'sponsorship' && g.severity === 'blocker'));
  assert.equal(data.artifacts.resume, null, 'no documents generated');
  await c.put('/api/preferences', prefs);
});

test('users cannot see each other\'s data', async () => {
  const other = new Client(srv.url);
  const s = await other.post('/api/auth/signup', { email: 'other@example.com', password: 'another long passphrase' });
  assert.equal(s.status, 201);
  assert.equal((await other.get(`/api/applications/${appId}`)).status, 404);
  assert.equal((await other.get('/api/applications')).data.applications.length, 0);
  assert.equal((await other.get('/api/brain')).data.brain.evidence.length, 0);
  const docs = (await c.get('/api/documents')).data.documents;
  assert.equal((await other.get(`/api/documents/${docs[0].id}/file`)).status, 404);
});

test('export and account deletion', async () => {
  const exp = await c.get('/api/account/export');
  assert.equal(exp.status, 200);
  assert.equal(Buffer.from(exp.data).subarray(0, 2).toString(), 'PK');
  const bad = await c.post('/api/account/delete', { password: 'wrong password', confirm: 'DELETE' });
  assert.equal(bad.status, 401);
  const del = await c.post('/api/account/delete', { password: 'a long passphrase here', confirm: 'DELETE' });
  assert.equal(del.status, 200);
  assert.equal((await c.get('/api/brain')).status, 401);
  const rows = srv.app.db.one<{ n: number }>("SELECT COUNT(*) AS n FROM evidence WHERE user_id NOT IN (SELECT id FROM users)");
  assert.equal(Number(rows!.n), 0, 'evidence removed with the account');
});
