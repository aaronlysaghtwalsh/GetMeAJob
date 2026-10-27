import type { App } from '../app';
import { parseJson } from '../db/database';
import { newId, nowIso } from '../lib/ids';
import { describeAiError } from '../ai/errors';

export type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

export interface TaskProgress {
  steps: { key: string; label: string; status: StepStatus; detail?: string }[];
  message?: string;
}

export interface TaskDTO {
  id: string;
  type: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';
  applicationId: string | null;
  progress: TaskProgress;
  result: unknown;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

interface TaskRow {
  id: string;
  user_id: string;
  application_id: string | null;
  type: string;
  status: TaskDTO['status'];
  input: string;
  progress: string;
  result: string | null;
  error: string | null;
  attempts: number;
  cancel_requested: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export class Progress {
  constructor(
    private state: TaskProgress,
    private persist: (p: TaskProgress) => void,
  ) {}

  private set(key: string, status: StepStatus, detail?: string) {
    const step = this.state.steps.find((s) => s.key === key);
    if (!step) return;
    step.status = status;
    if (detail !== undefined) step.detail = detail;
    this.persist(this.state);
  }
  start(key: string, detail?: string) {
    this.set(key, 'running', detail);
  }
  done(key: string, detail?: string) {
    this.set(key, 'done', detail);
  }
  fail(key: string, detail?: string) {
    this.set(key, 'failed', detail);
  }
  skip(key: string, detail?: string) {
    this.set(key, 'skipped', detail);
  }
  message(text: string) {
    this.state.message = text;
    this.persist(this.state);
  }
  /** Mark every still-pending step as skipped (e.g. after an early stop). */
  skipRemaining(detail?: string) {
    for (const s of this.state.steps) if (s.status === 'pending') s.status = 'skipped';
    if (detail) this.state.message = detail;
    this.persist(this.state);
  }
}

export interface TaskContext<I = Record<string, unknown>> {
  app: App;
  taskId: string;
  userId: string;
  applicationId: string | null;
  input: I;
  signal: AbortSignal;
  progress: Progress;
}

export type TaskHandler = (ctx: TaskContext<any>) => Promise<unknown>;

function toDTO(row: TaskRow): TaskDTO {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    applicationId: row.application_id,
    progress: parseJson<TaskProgress>(row.progress, { steps: [] }),
    result: parseJson(row.result, null),
    error: row.error,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

/**
 * Persistent background task queue (SQLite-backed) with an in-process worker.
 * Tasks on the same application, or Career Brain tasks for the same user, run one at a time.
 */
export class TaskQueue {
  private handlers = new Map<string, TaskHandler>();
  private running = new Map<string, { controller: AbortController; lane: string; promise: Promise<void> }>();
  private timer: NodeJS.Timeout | null = null;
  private waiters = new Map<string, ((t: TaskDTO) => void)[]>();

  constructor(
    private app: App,
    private concurrency = 2,
  ) {}

  register(type: string, handler: TaskHandler): void {
    this.handlers.set(type, handler);
  }

  enqueue(opts: { userId: string; type: string; applicationId?: string | null; input?: unknown; steps?: { key: string; label: string }[] }): TaskDTO {
    const id = newId('tsk');
    const progress: TaskProgress = { steps: (opts.steps ?? []).map((s) => ({ ...s, status: 'pending' as StepStatus })) };
    this.app.db.run(
      `INSERT INTO tasks (id, user_id, application_id, type, status, input, progress, created_at) VALUES (?, ?, ?, ?, 'queued', ?, ?, ?)`,
      [id, opts.userId, opts.applicationId ?? null, opts.type, JSON.stringify(opts.input ?? {}), JSON.stringify(progress), nowIso()],
    );
    setImmediate(() => this.tick());
    return this.get(opts.userId, id)!;
  }

  get(userId: string, taskId: string): TaskDTO | null {
    const row = this.app.db.one<TaskRow>('SELECT * FROM tasks WHERE id = ? AND user_id = ?', [taskId, userId]);
    return row ? toDTO(row) : null;
  }

  active(userId: string, filter: { applicationId?: string; typePrefix?: string } = {}): TaskDTO[] {
    const rows = this.app.db.all<TaskRow>(
      `SELECT * FROM tasks WHERE user_id = ? AND status IN ('queued','running') ORDER BY created_at`,
      [userId],
    );
    return rows
      .filter((r) => (filter.applicationId ? r.application_id === filter.applicationId : true))
      .filter((r) => (filter.typePrefix ? r.type.startsWith(filter.typePrefix) : true))
      .map(toDTO);
  }

  recent(userId: string, filter: { applicationId?: string; typePrefix?: string; limit?: number } = {}): TaskDTO[] {
    const rows = this.app.db.all<TaskRow>(`SELECT * FROM tasks WHERE user_id = ? ORDER BY created_at DESC LIMIT 200`, [userId]);
    return rows
      .filter((r) => (filter.applicationId ? r.application_id === filter.applicationId : true))
      .filter((r) => (filter.typePrefix ? r.type.startsWith(filter.typePrefix) : true))
      .slice(0, filter.limit ?? 20)
      .map(toDTO);
  }

  cancel(userId: string, taskId: string): boolean {
    const row = this.app.db.one<TaskRow>('SELECT * FROM tasks WHERE id = ? AND user_id = ?', [taskId, userId]);
    if (!row || !['queued', 'running'].includes(row.status)) return false;
    if (row.status === 'queued') {
      this.finish(row.id, 'canceled', null, 'Canceled before it started.');
      return true;
    }
    this.app.db.run('UPDATE tasks SET cancel_requested = 1 WHERE id = ?', [taskId]);
    this.running.get(taskId)?.controller.abort();
    return true;
  }

  /** Resolve when the task reaches a terminal state (used by tests and synchronous helpers). */
  waitFor(taskId: string, timeoutMs = 120_000): Promise<TaskDTO> {
    const row = this.app.db.one<TaskRow>('SELECT * FROM tasks WHERE id = ?', [taskId]);
    if (row && ['succeeded', 'failed', 'canceled'].includes(row.status)) return Promise.resolve(toDTO(row));
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`Timed out waiting for task ${taskId}`)), timeoutMs);
      const list = this.waiters.get(taskId) ?? [];
      list.push((dto) => {
        clearTimeout(t);
        resolve(dto);
      });
      this.waiters.set(taskId, list);
    });
  }

  start(): void {
    // Tasks left running by a crash/restart are re-queued once, then failed.
    const stale = this.app.db.all<TaskRow>(`SELECT * FROM tasks WHERE status = 'running'`);
    for (const row of stale) {
      if (row.attempts < 2) this.app.db.run(`UPDATE tasks SET status = 'queued' WHERE id = ?`, [row.id]);
      else this.finish(row.id, 'failed', null, 'Interrupted by a server restart.');
    }
    this.timer = setInterval(() => this.tick(), 500);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const r of this.running.values()) r.controller.abort();
    await Promise.allSettled([...this.running.values()].map((r) => r.promise));
  }

  private laneOf(row: TaskRow): string {
    if (row.application_id) return `app:${row.application_id}`;
    return `user:${row.user_id}:${row.type.split('.')[0]}`;
  }

  private tick(): void {
    if (this.running.size >= this.concurrency) return;
    const queued = this.app.db.all<TaskRow>(`SELECT * FROM tasks WHERE status = 'queued' ORDER BY created_at LIMIT 25`);
    const busy = new Set([...this.running.values()].map((r) => r.lane));
    for (const row of queued) {
      if (this.running.size >= this.concurrency) break;
      const lane = this.laneOf(row);
      if (busy.has(lane)) continue;
      const claimed = this.app.db.run(`UPDATE tasks SET status = 'running', started_at = ?, attempts = attempts + 1 WHERE id = ? AND status = 'queued'`, [
        nowIso(),
        row.id,
      ]);
      if (!claimed.changes) continue;
      busy.add(lane);
      const controller = new AbortController();
      const promise = this.execute(row, controller).finally(() => {
        this.running.delete(row.id);
        setImmediate(() => this.tick());
      });
      this.running.set(row.id, { controller, lane, promise });
    }
  }

  private async execute(row: TaskRow, controller: AbortController): Promise<void> {
    const handler = this.handlers.get(row.type);
    if (!handler) {
      this.finish(row.id, 'failed', null, `No handler for task type ${row.type}`);
      return;
    }
    const progressState = parseJson<TaskProgress>(row.progress, { steps: [] });
    const progress = new Progress(progressState, (p) => {
      this.app.db.run('UPDATE tasks SET progress = ? WHERE id = ?', [JSON.stringify(p), row.id]);
    });
    try {
      const result = await handler({
        app: this.app,
        taskId: row.id,
        userId: row.user_id,
        applicationId: row.application_id,
        input: parseJson(row.input, {}),
        signal: controller.signal,
        progress,
      });
      this.finish(row.id, 'succeeded', result ?? null, null);
    } catch (err) {
      const canceled = controller.signal.aborted;
      for (const s of progressState.steps) if (s.status === 'running') s.status = canceled ? 'skipped' : 'failed';
      this.app.db.run('UPDATE tasks SET progress = ? WHERE id = ?', [JSON.stringify(progressState), row.id]);
      if (!canceled) this.app.log(`Task ${row.type} ${row.id} failed`, err);
      this.finish(row.id, canceled ? 'canceled' : 'failed', null, canceled ? 'Canceled.' : describeAiError(err));
    }
  }

  private finish(id: string, status: TaskDTO['status'], result: unknown, error: string | null) {
    this.app.db.run('UPDATE tasks SET status = ?, result = ?, error = ?, finished_at = ? WHERE id = ?', [
      status,
      result === null ? null : JSON.stringify(result),
      error,
      nowIso(),
      id,
    ]);
    const row = this.app.db.one<TaskRow>('SELECT * FROM tasks WHERE id = ?', [id]);
    const waiters = this.waiters.get(id);
    if (row && waiters) {
      this.waiters.delete(id);
      for (const w of waiters) w(toDTO(row));
    }
  }
}
