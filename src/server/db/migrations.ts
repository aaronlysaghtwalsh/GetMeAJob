/**
 * Schema migrations. Append-only: never edit a migration that has shipped.
 *
 * Design notes
 * - Every user-owned row carries user_id and every query is scoped by it (see repos/).
 * - IDs are prefixed random strings; timestamps are ISO-8601 UTC strings.
 * - Flexible, schema-validated structures (AI outputs, preferences) are JSON text columns validated with zod
 *   at the boundary. The column types map 1:1 to Postgres (TEXT/JSONB/INTEGER/REAL) for the future SaaS move.
 */
export interface Migration {
  id: number;
  name: string;
  sql: string;
}

export const migrations: Migration[] = [
  {
    id: 1,
    name: 'initial schema',
    sql: /* sql */ `
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  email_normalized TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  plan TEXT NOT NULL DEFAULT 'personal',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  meta TEXT NOT NULL DEFAULT '{}',
  ip TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_audit_user ON audit_log(user_id, created_at);

CREATE TABLE user_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data TEXT NOT NULL DEFAULT '{}',
  secrets_enc TEXT,
  updated_at TEXT NOT NULL
);

-- Career Brain -----------------------------------------------------------------

CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  text_content TEXT,
  text_method TEXT,
  status TEXT NOT NULL,
  error TEXT,
  extraction TEXT,
  included_in_brain INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_documents_user ON documents(user_id, created_at);
CREATE UNIQUE INDEX idx_documents_user_hash ON documents(user_id, sha256);

CREATE TABLE profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  headline TEXT NOT NULL DEFAULT '',
  links TEXT NOT NULL DEFAULT '[]',
  sources TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL
);

CREATE TABLE experiences (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  organization TEXT NOT NULL,
  title TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT '',
  start_date TEXT NOT NULL DEFAULT '',
  end_date TEXT NOT NULL DEFAULT '',
  is_current INTEGER NOT NULL DEFAULT 0,
  employment_type TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  provenance TEXT NOT NULL,
  sources TEXT NOT NULL DEFAULT '[]',
  sort_order INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_experiences_user ON experiences(user_id);

CREATE TABLE education (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  institution TEXT NOT NULL,
  degree TEXT NOT NULL DEFAULT '',
  field TEXT NOT NULL DEFAULT '',
  minor TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  start_date TEXT NOT NULL DEFAULT '',
  end_date TEXT NOT NULL DEFAULT '',
  grade TEXT NOT NULL DEFAULT '',
  coursework TEXT NOT NULL DEFAULT '[]',
  honors TEXT NOT NULL DEFAULT '[]',
  provenance TEXT NOT NULL,
  sources TEXT NOT NULL DEFAULT '[]',
  sort_order INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_education_user ON education(user_id);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  context TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT '',
  start_date TEXT NOT NULL DEFAULT '',
  end_date TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  technologies TEXT NOT NULL DEFAULT '[]',
  provenance TEXT NOT NULL,
  sources TEXT NOT NULL DEFAULT '[]',
  sort_order INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_projects_user ON projects(user_id);

CREATE TABLE evidence (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  statement TEXT NOT NULL,
  kind TEXT NOT NULL,
  subject_type TEXT NOT NULL DEFAULT 'general',
  subject_id TEXT,
  metrics TEXT NOT NULL DEFAULT '[]',
  skills TEXT NOT NULL DEFAULT '[]',
  themes TEXT NOT NULL DEFAULT '[]',
  provenance TEXT NOT NULL,
  sources TEXT NOT NULL DEFAULT '[]',
  user_confirmed INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_evidence_user ON evidence(user_id);
CREATE INDEX idx_evidence_subject ON evidence(user_id, subject_type, subject_id);

CREATE TABLE skills (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  name_normalized TEXT NOT NULL,
  category TEXT NOT NULL,
  provenance TEXT NOT NULL,
  evidence_ids TEXT NOT NULL DEFAULT '[]',
  sources TEXT NOT NULL DEFAULT '[]',
  hidden INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_skills_user_name ON skills(user_id, name_normalized);

CREATE TABLE resume_sources (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  focus TEXT NOT NULL DEFAULT '',
  structure TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_resume_sources_doc ON resume_sources(document_id);

CREATE TABLE discovery_questions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  rationale TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 50,
  target_type TEXT NOT NULL DEFAULT 'general',
  target_id TEXT,
  answer_type TEXT NOT NULL DEFAULT 'text',
  choices TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'open',
  answer TEXT,
  applied TEXT,
  created_at TEXT NOT NULL,
  answered_at TEXT
);
CREATE INDEX idx_questions_user ON discovery_questions(user_id, status, priority);

CREATE TABLE preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);

-- Jobs & applications ------------------------------------------------------------

CREATE TABLE companies (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  name_normalized TEXT NOT NULL,
  website TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_companies_user_name ON companies(user_id, name_normalized);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id TEXT REFERENCES companies(id) ON DELETE SET NULL,
  title TEXT NOT NULL DEFAULT '',
  company_name TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  work_model TEXT NOT NULL DEFAULT 'unknown',
  salary_text TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL,
  source_url TEXT NOT NULL DEFAULT '',
  ats TEXT NOT NULL DEFAULT 'unknown',
  raw_text TEXT NOT NULL,
  intelligence TEXT,
  imported_questions TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_jobs_user ON jobs(user_id);

CREATE TABLE applications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  stage TEXT NOT NULL DEFAULT 'discovered',
  tier TEXT,
  research_depth TEXT NOT NULL DEFAULT 'deep',
  date_applied TEXT,
  outcome TEXT,
  next_action TEXT NOT NULL DEFAULT '',
  next_action_date TEXT,
  final_resume_id TEXT,
  final_cover_letter_id TEXT,
  submitted_snapshot TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_applications_user ON applications(user_id, stage);
CREATE UNIQUE INDEX idx_applications_job ON applications(job_id);

CREATE TABLE application_questions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  limit_type TEXT NOT NULL DEFAULT 'none',
  limit_value INTEGER,
  required INTEGER NOT NULL DEFAULT 1,
  sensitive INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_app_questions ON application_questions(application_id, sort_order);

CREATE TABLE artifacts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  ref_id TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  content TEXT NOT NULL,
  meta TEXT NOT NULL DEFAULT '{}',
  parent_id TEXT,
  change_summary TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT 'ai',
  created_at TEXT NOT NULL,
  approved_at TEXT
);
CREATE UNIQUE INDEX idx_artifacts_version ON artifacts(application_id, kind, ref_id, version);
CREATE INDEX idx_artifacts_user ON artifacts(user_id);

CREATE TABLE application_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}',
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_events_app ON application_events(application_id, occurred_at);

CREATE TABLE contacts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  application_id TEXT REFERENCES applications(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'other',
  title TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  linkedin_url TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  last_contacted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_contacts_app ON contacts(application_id);

CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_notes_app ON notes(application_id);

-- Infrastructure -------------------------------------------------------------------

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  application_id TEXT REFERENCES applications(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  input TEXT NOT NULL DEFAULT '{}',
  progress TEXT NOT NULL DEFAULT '{}',
  result TEXT,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);
CREATE INDEX idx_tasks_status ON tasks(status, created_at);
CREATE INDEX idx_tasks_user ON tasks(user_id, created_at);

CREATE TABLE ai_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id TEXT,
  purpose TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  web_searches INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_ai_runs_user ON ai_runs(user_id, created_at);

CREATE TABLE feedback (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  rating TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  comment TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_feedback_artifact ON feedback(artifact_id);
`,
  },
];
