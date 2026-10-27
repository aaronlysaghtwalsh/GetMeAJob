# Architecture

GetMeAJob is one Node.js process that serves a React single-page app and a JSON API, stores everything in SQLite, and calls an AI provider for the steps that need judgment. It runs on the applicant's own machine today and is structured so the same code can become a hosted multi-user service.

## Principles that shape the code

1. **Strategy before documents.** The resume, cover letter and answers are generated from a stored strategy artifact, never directly from the job description.
2. **Evidence over prose.** The Career Brain stores evidence items with verbatim quotes and provenance. Generation prompts can only reference evidence by id, and output is validated against those ids.
3. **Deterministic where possible.** Names, titles, employers, dates, scores and ATS checks are computed in code. The model chooses and phrases; code assembles, checks and renders.
4. **The applicant approves.** Every generated document is a draft until approved. Submission is a human action that the app records; it never submits anywhere.

## Layout

```
src/
  shared/            Types and zod schemas used by server, client and AI prompts
    constants.ts     Provenance, stages, tiers, voices, labels
    schemas/         brain, job, research, fit, strategy, documents
  server/
    main.ts          Entry: config, app, task handlers, HTTP server
    app.ts           Composition root (db, storage, AI, task queue, rate limits)
    http/            node:http adapter to web Request/Response, router, cookies, errors, static files, CSP
    db/              SQLite (node:sqlite, WAL), migrations
    repos/           User-scoped data access (every query filters by user_id)
    security/        scrypt passwords, sessions, AES-256-GCM, rate limits, audit log
    ai/              Provider abstraction: Anthropic, OpenAI, OpenAI-compatible, scripted (tests)
    services/
      documents/     Parsing (PDF, DOCX, text, images), resume model, DOCX/PDF rendering, ATS parse-back
      brain/         Extraction, consolidation, discovery questions, readiness
      jobs/          Job link import (ATS public APIs, schema.org JobPosting) with SSRF protection
      pipeline/      Job intelligence, research, fit, strategy, documents, orchestration
      integrity/     Claim validator and writing lint
      questions/     Application question parsing, limits, sensitive-topic detection
    tasks/           Durable background queue (SQLite) with progress, lanes and cancellation
    routes/          auth, brain, applications, tasks, settings, dashboard
  client/
    lib/             API client, query cache, router, auth, task watcher
    components/      UI primitives, overlays, layout, domain components (evidence, provenance, versions)
    pages/           Dashboard, Career Brain, Applications, workspace tabs, Settings, Roadmap
tests/
  unit/, integration/  node:test; the integration suite runs the whole loop over HTTP
  e2e/                 Playwright walkthrough of the UI
  fixtures/            A fictional applicant and scripted AI responses
```

## Data model

SQLite tables (all user-owned rows carry `user_id`):

- **Identity:** `users`, `sessions`, `user_settings` (AI provider, models, encrypted keys), `audit_log`
- **Career Brain:** `profiles`, `documents` (encrypted originals plus extracted text), `experiences`, `education`, `projects`, `evidence` (text, verbatim quote, metrics, themes, provenance, source document), `skills` (with supporting evidence ids), `resume_sources` (which resume said what), `discovery_questions`, `preferences`
- **Applications:** `companies`, `jobs` (raw posting plus job intelligence), `applications` (stage, tier, dates, next action, submitted snapshot), `application_questions`, `artifacts` (versioned research, fit, strategy, resume, cover letter, answers and review; a new version is a new row, so nothing is overwritten), `contacts`, `notes`, `application_events`, `feedback`
- **Operations:** `tasks` (queue), `ai_runs` (every AI call with tokens, searches, cost estimate and duration)

The schema avoids SQLite-only features, so moving to Postgres is a driver change plus migrations.

## The pipeline

`application.build` runs these steps as one background task, each a stored artifact:

1. **Job intelligence:** structured requirements (R1…), responsibilities, keywords, screening criteria and sponsorship stance.
2. **Company research:** a free-text web-search pass that returns cited text, then a structuring pass that turns it into findings labelled fact, interpretation or hypothesis, each tied to a source. The two passes are separate because providers reject citations combined with strict JSON output.
3. **Fit analysis:** the model judges each requirement against evidence ids. Code computes coverage, the overall score and the final tier, and applies guardrails (for example "needs sponsorship" with "no sponsorship" is a blocker). On a blocker the build stops and recommends not applying, unless the applicant chooses to continue.
4. **Strategy:** positioning, what to lead with and play down, objections, which resume to base on (one, a combination, or a rebuild), ordering, honest keywords and the cover-letter angle.
5. **Resume:** the model selects and phrases bullets that cite evidence ids; code assembles the document from records, filters skills to those in the Career Brain, runs the integrity check, asks the model to repair failing lines once, drops anything still unsupported, renders DOCX and PDF, and parses both back for the ATS check.
6. **Cover letter**, then 7. **answers** (per question, with limits), each integrity-checked and linted for clichés and AI-style phrasing.
8. **Review:** scores, strengths, weaknesses and concrete find-and-replace recommendations. Accepting one creates a new version.

Model output is always constrained by a JSON schema (provider-native structured outputs, with a validate-and-retry fallback) and validated with zod. Internally the model sees short references (`E12`, `R3`, `F2`) that code maps back to database ids.

## Integrity engine

`services/integrity/validator.ts` checks every generated line against the evidence it cites:

- numbers and quantities (including "two", "40k", "35%") must appear in the cited evidence or the applicant's answers
- tools and technologies must be in the cited evidence or the Career Brain's skills
- titles, employers and dates are never generated; they are rendered from records
- only *verified* and *applicant-provided* evidence can be cited

Failures are blockers. The pipeline repairs once, then removes what is still unsupported and reports it. The approve endpoint refuses any artifact that still has blockers.

## AI providers

`ai/registry.ts` maps four roles (extraction, reasoning, writing, research) to default models per provider; the applicant can override each in Settings. The Anthropic provider uses the Messages API with streaming, `output_config.format` for JSON schema output, `output_config.effort`, adaptive thinking and the web search tool, and handles `pause_turn`. The OpenAI provider uses the Responses API with structured outputs and web search. Any OpenAI-compatible endpoint works without web research. A scripted provider makes the whole pipeline testable offline.

## Security

- Passwords are hashed with scrypt; session tokens are random and stored only as hashes; cookies are httpOnly and SameSite=Lax.
- State-changing requests need a same-origin check and a custom header (CSRF).
- Documents and API keys are encrypted at rest with AES-256-GCM, using keys derived (HKDF) from the app secret.
- There is a strict Content-Security-Policy and no third-party scripts or fonts. The server binds to 127.0.0.1 by default.
- Login, sign-up and AI-start endpoints are rate-limited. Sign-ins, uploads, approvals, exports and deletions are audited.
- Job-link import blocks private and loopback addresses (SSRF), sends one request per user action, and does not scrape sites whose terms forbid automation (LinkedIn, Indeed, Glassdoor and others): the applicant pastes those postings instead.
- Export produces a ZIP of every record and original document; account deletion removes rows and files.

## Path to SaaS

What is already in place: per-user isolation in every repository function, per-user AI settings and keys, usage metering per call, a `plan` column on users, configurable sign-up modes, and background work that survives restarts. What remains: Postgres, object storage for documents, a worker process for the queue, email verification and password reset, organizations, billing and plan limits, and HTTPS deployment.

## Testing

- `npm test` runs unit tests and an integration suite that drives the full loop over HTTP with scripted AI: multi-resume consolidation, conflicts, discovery answers, research citations, fit guardrails, strategy, integrity repair (a deliberately invented number and an unsupported tool are caught), ATS parse-back of real DOCX and PDF output, sensitive-answer confirmation, the submission gate, data isolation between users, export and account deletion.
- `npm run test:e2e` runs the same journey in a real browser.

## Build notes

The project has no runtime build step beyond esbuild: `npm run build` bundles the client (React, Tailwind CSS 4) and the server into `dist/`. The environment this was built in had no npm registry access, so client types were checked against a minimal local React type shim; run `npm run typecheck` once after `npm install` to check against the real `@types/react`.
