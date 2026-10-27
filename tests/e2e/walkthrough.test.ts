// Browser walkthrough of the core loop with scripted AI:
// sign up -> upload two resumes -> resolve a conflict -> preferences -> new application -> build ->
// approve everything (including a sensitive answer) -> mark as submitted -> tracker.
//
// Needs Playwright and a Chromium build:  npm i -D playwright && npx playwright install chromium
// Run with:  npm run test:e2e
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startTestServer, type TestServer } from '../helpers';
import { resumeADocx, resumeBPdf, JOB_POSTING, JOB_QUESTIONS } from '../fixtures/persona';

type PW = typeof import('playwright');
let pw: PW | null = null;
try {
  pw = await import('playwright');
} catch {
  pw = null;
}

let server: TestServer;
let browser: import('playwright').Browser;
let page: import('playwright').Page;
const files = fs.mkdtempSync(path.join(os.tmpdir(), 'gmaj-e2e-'));
const consoleErrors: string[] = [];

const skip = !pw ? 'Playwright is not installed (npm i -D playwright && npx playwright install chromium)' : false;

before(async () => {
  if (!pw) return;
  fs.writeFileSync(path.join(files, 'analytics.docx'), await resumeADocx());
  fs.writeFileSync(path.join(files, 'client.pdf'), await resumeBPdf());
  server = await startTestServer({ signupMode: 'first-user' });
  browser = await pw.chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {});
  page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  page.on('pageerror', (e) => consoleErrors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
});

after(async () => {
  await browser?.close();
  await server?.close();
  fs.rmSync(files, { recursive: true, force: true });
});

/** Wait until the API reports no running tasks for a resource. */
async function waitIdle(url: string, ms = 60_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const r = await page.request.get(server.url + url);
    const j = await r.json();
    if (!(j.tasks ?? []).length) return j;
    await page.waitForTimeout(250);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

test('core loop in the browser', { skip, timeout: 240_000 }, async () => {
  const base = server.url;

  // Account
  await page.goto(base + '/');
  await page.getByLabel('Your name').fill('Jordan Avery');
  await page.getByLabel('Email').fill('jordan@example.com');
  await page.getByLabel('Password').fill('correct horse battery');
  await page.getByRole('button', { name: 'Create account' }).click();
  // New accounts start on the Career Brain, the first step of the workflow.
  await page.getByText('Start by uploading your resume').first().waitFor();

  // Career Brain from two resumes
  await page.getByRole('button', { name: 'Upload documents' }).first().click();
  await page.locator('input[type=file]').setInputFiles([path.join(files, 'analytics.docx'), path.join(files, 'client.pdf')]);
  await page.getByRole('button', { name: /^Upload 2 files/ }).click();
  await page.waitForTimeout(300);
  await waitIdle('/api/brain');
  await page.reload();
  await page.getByText('Data Analytics Intern').first().waitFor();
  await page.getByText('2 sources').first().waitFor();

  // The two resumes disagree on an end date: resolve it with a one-tap option
  await page.goto(base + '/brain/questions');
  await page.getByText('Your documents disagree').waitFor();
  await page.getByRole('button', { name: 'May 2025', exact: true }).click();
  await page.getByRole('button', { name: 'Save answer' }).click();
  await page.waitForTimeout(300);
  await waitIdle('/api/brain');

  // Preferences, including work authorization
  await page.goto(base + '/brain/preferences');
  const group = (name: string) => page.getByRole('group', { name });
  const roles = group('Target roles').getByRole('textbox');
  await roles.fill('Customer Insights Analyst');
  await roles.press('Enter');
  const loc = group('Locations').getByRole('textbox');
  await loc.fill('Chicago, IL');
  await loc.press('Enter');
  await group('Work models').getByRole('checkbox', { name: 'Hybrid', exact: true }).click();
  await group('Are you legally authorized to work there?').getByRole('radio', { name: 'Yes', exact: true }).click();
  await group('Do you need visa sponsorship now?').getByRole('radio', { name: 'No', exact: true }).click();
  await group('Will you need sponsorship in the future?').getByRole('radio', { name: 'No', exact: true }).click();
  await page.getByRole('button', { name: 'Save preferences' }).click();
  await page.getByText('Preferences saved.').waitFor();

  // New application, full build
  await page.goto(base + '/applications/new');
  await page.getByLabel('Job description').fill(JOB_POSTING);
  await page.getByPlaceholder(/Why are you interested in this role/).fill(JOB_QUESTIONS);
  await page.getByRole('button', { name: 'Build application' }).click();
  await page.waitForURL(/\/applications\/app_/);
  const id = new URL(page.url()).pathname.split('/')[2];
  await waitIdle(`/api/applications/${id}`, 120_000);
  await page.reload();
  await page.getByText('Application materials').waitFor();
  await page.getByText('High priority').first().waitFor();

  // Strategy exists and documents were built from it
  await page.goto(`${base}/applications/${id}/strategy`);
  await page.getByRole('heading', { name: 'Lead with' }).waitFor();
  await page.goto(`${base}/applications/${id}/resume`);
  await page.getByText('Every claim is backed by your evidence').waitFor();
  assert.equal(await page.getByText('Salesforce', { exact: true }).count() > 0, true, 'unsupported keyword is shown as excluded');
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await page.getByText('Approved', { exact: true }).first().waitFor();

  await page.goto(`${base}/applications/${id}/cover-letter`);
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await page.getByText('Approved', { exact: true }).first().waitFor();

  // Answers: the sponsorship answer needs an explicit confirmation
  await page.goto(`${base}/applications/${id}/questions`);
  const cards = page.locator('article');
  await cards.first().waitFor();
  let confirmedSensitive = false;
  for (let i = 0; i < (await cards.count()); i++) {
    const card = cards.nth(i);
    const sensitive = (await card.getByText('Sensitive, review yourself').count()) > 0;
    await card.getByRole('button', { name: 'Approve', exact: true }).click();
    if (sensitive) {
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('checkbox').check();
      await dialog.getByRole('button', { name: 'Approve answer' }).click();
      await dialog.waitFor({ state: 'detached' });
      confirmedSensitive = true;
    }
    await card.getByText('Approved', { exact: true }).waitFor();
  }
  assert.equal(confirmedSensitive, true, 'sensitive answer asked for confirmation');

  // Human submission gate
  const check = await (await page.request.get(`${base}/api/applications/${id}/submission-check`)).json();
  assert.deepEqual(check.problems, [], 'everything approved before submitting');
  await page.goto(`${base}/applications/${id}/review`);
  await page.getByText('Everything you are sending is approved.').waitFor();
  await page.getByRole('button', { name: 'Mark as submitted' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('checkbox', { name: /I submitted this application/ }).waitFor();
  await dialog.getByRole('checkbox', { name: /I submitted this application/ }).check();
  await dialog.getByRole('button', { name: 'Mark as submitted' }).click();
  await page.getByText(/Marked as submitted/).waitFor();

  // Tracker
  await page.goto(`${base}/applications/${id}/tracking`);
  await page.getByText('Application submitted').waitFor();
  await page.goto(`${base}/applications`);
  await page.getByText('Customer Insights Analyst').first().waitFor();

  assert.deepEqual(consoleErrors, [], 'no browser errors');
});
