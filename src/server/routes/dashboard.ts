import type { Router } from '../http/router';
import { json, requireUser } from '../http/core';
import * as appRepo from '../repos/applications';
import { computeReadiness } from '../services/brain/readiness';
import { listQuestions } from '../repos/brain';
import { INTERVIEW_STAGES, STAGES_AFTER_APPLY, STAGE_GROUP, TIER_LABEL, type Stage } from '../../shared/constants';
import type { FitContent } from '../../shared/schemas/fit';
import type { ReviewContent } from '../../shared/schemas/documents';

interface Attention {
  kind: 'follow_up' | 'due' | 'ready' | 'high_match' | 'failed' | 'brain' | 'review';
  title: string;
  detail: string;
  href: string;
  priority: number;
}

const DAY = 86400_000;

export function dashboardRoutes(r: Router) {
  r.get('/api/dashboard', (ctx) => {
    const user = requireUser(ctx);
    const db = ctx.app.db;
    const rows = db.all<Record<string, any>>(
      `SELECT a.*, j.title AS job_title, j.company_name FROM applications a JOIN jobs j ON j.id = a.job_id WHERE a.user_id = ? AND a.archived = 0 ORDER BY a.updated_at DESC`,
      [user.id],
    );
    const now = Date.now();
    const weekAgo = now - 7 * DAY;
    const monthAgo = now - 30 * DAY;
    const applied = rows.filter((r) => r.date_applied || STAGES_AFTER_APPLY.includes(r.stage as Stage));
    const appliedAt = (r: Record<string, any>) => (r.date_applied ? Date.parse(r.date_applied) : Date.parse(r.updated_at));
    const reachedInterview = applied.filter((r) => INTERVIEW_STAGES.includes(r.stage as Stage) || hadStage(db, user.id, r.id, INTERVIEW_STAGES as Stage[]));
    const finals = rows.filter((r) => ['final', 'offer', 'accepted'].includes(r.stage) || hadStage(db, user.id, r.id, ['final']));
    const offers = rows.filter((r) => ['offer', 'accepted'].includes(r.stage));
    const MIN_FOR_RATE = 5;

    const pipeline = { pipeline: 0, active: 0, interviewing: 0, closed: 0 };
    const byStage: Record<string, number> = {};
    for (const r of rows) {
      pipeline[STAGE_GROUP[r.stage as Stage]]++;
      byStage[r.stage] = (byStage[r.stage] ?? 0) + 1;
    }

    const attention: Attention[] = [];
    for (const r of rows) {
      const label = `${r.job_title || 'Role'} at ${r.company_name || 'company'}`;
      if (r.next_action_date && Date.parse(r.next_action_date) <= now + DAY) {
        attention.push({ kind: 'due', title: r.next_action || 'Next step due', detail: label, href: `/applications/${r.id}/tracking`, priority: 90 });
      }
      if (r.stage === 'applied' && r.date_applied && now - Date.parse(r.date_applied) >= 7 * DAY && !r.next_action_date) {
        const followed = db.one(`SELECT 1 FROM application_events WHERE application_id = ? AND type = 'follow_up'`, [r.id]);
        if (!followed) {
          attention.push({
            kind: 'follow_up',
            title: `Follow up with ${r.company_name || 'the employer'}`,
            detail: `You applied ${Math.round((now - Date.parse(r.date_applied)) / DAY)} days ago and have not followed up.`,
            href: `/applications/${r.id}/tracking`,
            priority: 80,
          });
        }
      }
      if (['researching', 'preparing'].includes(r.stage)) {
        const review = appRepo.latestArtifact<ReviewContent>(db, user.id, r.id, 'review');
        if (review && review.content.verdict === 'ready') {
          attention.push({ kind: 'ready', title: `Ready to submit: ${label}`, detail: `Readiness ${review.content.overall}/100. Approve your materials and apply.`, href: `/applications/${r.id}/review`, priority: 85 });
        } else if (review && review.content.verdict !== 'ready') {
          attention.push({ kind: 'review', title: `Finish ${label}`, detail: `Readiness ${review.content.overall}/100: ${review.content.verdictReason.slice(0, 120)}`, href: `/applications/${r.id}/review`, priority: 60 });
        }
      }
      if (['discovered', 'considering', 'researching'].includes(r.stage) && ['apply_now', 'high_priority'].includes(r.tier)) {
        const fit = appRepo.latestArtifact<FitContent>(db, user.id, r.id, 'fit');
        if (fit && !appRepo.latestArtifact(db, user.id, r.id, 'resume')) {
          attention.push({ kind: 'high_match', title: `${TIER_LABEL[r.tier as keyof typeof TIER_LABEL]}: ${label}`, detail: fit.content.verdict.headline, href: `/applications/${r.id}`, priority: 75 });
        }
      }
    }
    for (const t of ctx.app.tasks.recent(user.id, { limit: 10 })) {
      if (t.status === 'failed' && Date.parse(t.finishedAt ?? t.createdAt) > now - 2 * DAY && t.applicationId) {
        const r = rows.find((x) => x.id === t.applicationId);
        const newer = ctx.app.tasks.recent(user.id, { applicationId: t.applicationId, limit: 1 })[0];
        if (r && newer?.id === t.id) attention.push({ kind: 'failed', title: `A step failed for ${r.company_name || 'an application'}`, detail: t.error ?? 'Retry from the workspace.', href: `/applications/${r.id}`, priority: 70 });
      }
    }
    const conflicts = listQuestions(db, user.id, ['open']).filter((q) => q.category === 'conflict').length;
    if (conflicts) attention.push({ kind: 'brain', title: `Confirm ${conflicts} detail${conflicts === 1 ? '' : 's'} in your Career Brain`, detail: 'Your documents disagree on these; applications need one consistent version.', href: '/brain/questions', priority: 88 });
    attention.sort((a, b) => b.priority - a.priority);

    const usage = db.one<{ cost: number; calls: number }>(`SELECT COALESCE(SUM(cost_usd),0) AS cost, COUNT(*) AS calls FROM ai_runs WHERE user_id = ? AND created_at >= ?`, [
      user.id,
      new Date(monthAgo).toISOString(),
    ]);

    return json({
      metrics: {
        appliedThisWeek: applied.filter((r) => appliedAt(r) >= weekAgo).length,
        appliedThisMonth: applied.filter((r) => appliedAt(r) >= monthAgo).length,
        totalApplied: applied.length,
        interviews: reachedInterview.length,
        interviewRate: applied.length >= MIN_FOR_RATE ? Math.round((reachedInterview.length / applied.length) * 100) : null,
        interviewRateNeeds: Math.max(0, MIN_FOR_RATE - applied.length),
        finals: finals.length,
        offers: offers.length,
      },
      pipeline,
      byStage,
      attention: attention.slice(0, 8),
      recent: rows.slice(0, 6).map((r) => ({ id: r.id, title: r.job_title, company: r.company_name, stage: r.stage, tier: r.tier, updatedAt: r.updated_at })),
      readiness: computeReadiness(ctx.app, user.id),
      usage: { costUsd: Math.round((usage?.cost ?? 0) * 100) / 100, calls: usage?.calls ?? 0 },
    });
  });
}

function hadStage(db: import('../db/database').Database, userId: string, applicationId: string, stages: Stage[]): boolean {
  const events = db.all<{ detail: string }>(`SELECT detail FROM application_events WHERE user_id = ? AND application_id = ? AND type = 'stage'`, [userId, applicationId]);
  return events.some((e) => {
    try {
      return stages.includes(JSON.parse(e.detail).to);
    } catch {
      return false;
    }
  });
}
