import type { ReactNode } from 'react';
import { LuArrowRight, LuCheck, LuClock, LuFileText, LuListChecks, LuMail, LuScale } from 'react-icons/lu';
import { api } from '../../../lib/api';
import { useAction } from '../../../lib/actions';
import { Link } from '../../../lib/router';
import { formatDate, minutes, relativeTime, sentence } from '../../../lib/format';
import type { WorkspaceData } from '../../../lib/types';
import { RESEARCH_DEPTH_LABEL, STAGE_LABEL } from '../../../../shared/constants';
import { Button, Panel } from '../../../components/ui/primitives';
import { ScoreFigure, TierBadge } from '../../../components/domain/provenance';
import { cn } from '../../../components/ui/cn';
import { refreshKeys } from './shared';

function MaterialRow({ icon, label, status, detail, href, tone }: { icon: ReactNode; label: string; status: string; detail: string; href: string; tone: 'jade' | 'neutral' | 'ochre' | 'brick' }) {
  return (
    <Link to={href} className="group flex items-center gap-3 py-3">
      <span className="text-mist [&>svg]:size-4">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-ink group-hover:underline">{label}</span>
        <span className="block truncate text-[12.5px] text-graphite">{detail}</span>
      </span>
      <span
        className={cn(
          'shrink-0 rounded-full px-2 py-0.5 text-[12px] font-medium',
          tone === 'jade' ? 'bg-jade-tint text-jade-strong' : tone === 'ochre' ? 'bg-ochre-tint text-ochre' : tone === 'brick' ? 'bg-brick-tint text-brick' : 'bg-ink/[0.06] text-graphite',
        )}
      >
        {status}
      </span>
    </Link>
  );
}

const BASE_DECISION_SHORT: Record<string, string> = {
  use_existing: 'based on one of your resumes',
  combine: 'combined from your resumes',
  rebuild: 'rebuilt from your evidence',
};

export function OverviewTab({ data, busy }: { data: WorkspaceData; busy: boolean }) {
  const { run, busy: acting } = useAction();
  const id = data.application.id;
  const { fit, strategy, resume, cover_letter: letter, review } = data.artifacts;
  const answered = data.questions.filter((q) => q.answer).length;
  const approvedAnswers = data.questions.filter((q) => q.answer?.status === 'approved').length;
  const app = data.application;

  if (!fit && !busy) {
    return (
      <Panel>
        <div className="flex flex-col items-start gap-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-display text-xl font-semibold text-ink">Ready when you are</h2>
            <p className="mt-1 max-w-xl text-sm text-graphite">Run the workflow to research the company, analyze your fit and build every document from one strategy.</p>
          </div>
          <Button variant="primary" loading={acting === 'build'} onClick={() => void run('build', () => api.post(`/api/applications/${id}/build`, { continueAnyway: false }), { refresh: refreshKeys(id) })}>
            Build application
          </Button>
        </div>
      </Panel>
    );
  }

  const resumeBlockers = resume?.content.integrity.issues.filter((i) => i.severity === 'blocker').length ?? 0;
  const next = (() => {
    if (busy) return { text: 'Working on your application. You can leave this page; progress is saved.', href: '', cta: '' };
    if (fit?.content.finalTier === 'do_not_apply' && !resume) return { text: 'Read why this role is not recommended before deciding.', href: `/applications/${id}/fit`, cta: 'Open fit analysis' };
    if (!resume) return { text: 'Generate the tailored resume.', href: `/applications/${id}/resume`, cta: 'Open resume' };
    if (resumeBlockers) return { text: 'Fix the unsupported claims in your resume.', href: `/applications/${id}/resume`, cta: 'Open resume' };
    if (resume.status !== 'approved') return { text: 'Read and approve your resume.', href: `/applications/${id}/resume`, cta: 'Open resume' };
    if (letter && letter.status !== 'approved') return { text: 'Read and approve your cover letter.', href: `/applications/${id}/cover-letter`, cta: 'Open cover letter' };
    if (data.questions.length && approvedAnswers < data.questions.length) return { text: 'Review and approve your answers.', href: `/applications/${id}/questions`, cta: 'Open answers' };
    if (!app.dateApplied) return { text: 'Everything is approved. Submit on the employer’s site, then mark it as submitted.', href: `/applications/${id}/review`, cta: 'Open review' };
    if (app.nextActionDate) return { text: `${app.nextAction || 'Next step'} by ${formatDate(app.nextActionDate)}.`, href: `/applications/${id}/tracking`, cta: 'Open tracking' };
    return { text: 'Log any replies or interviews in Tracking.', href: `/applications/${id}/tracking`, cta: 'Open tracking' };
  })();

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-w-0 flex-col gap-6">
        {fit && (
          <Panel>
            <div className="flex flex-wrap items-start justify-between gap-6">
              <div className="min-w-0 max-w-xl">
                <TierBadge tier={fit.content.finalTier} size="lg" />
                <p className="mt-3 font-display text-[21px] leading-snug text-ink">{fit.content.verdict.headline}</p>
                <Link to={`/applications/${id}/fit`} className="mt-3 inline-flex items-center gap-1 text-[13px] font-medium text-cobalt hover:underline">
                  Full fit analysis <LuArrowRight className="size-3.5" />
                </Link>
              </div>
              <div className="flex gap-8">
                <ScoreFigure value={fit.content.scores.overall} label="Overall fit" />
                <ScoreFigure value={fit.content.scores.requiredCoverage} label="Required qualifications covered" suffix="%" />
              </div>
            </div>
            <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 border-t border-rule pt-4 text-[13px] text-graphite">
              <span>
                Competitiveness: <span className="text-ink">{sentence(fit.content.competitiveness.level).toLowerCase()}</span>
              </span>
              <span className="inline-flex items-center gap-1">
                <LuClock className="size-3.5" /> About {minutes(fit.content.effortMinutes)} to finish well
              </span>
              <span>
                Recruiter would advance: <span className="text-ink">{sentence(fit.content.recruiterView.wouldAdvance).toLowerCase()}</span>
              </span>
            </div>
          </Panel>
        )}

        {strategy && (
          <section className="rounded-panel border border-rule bg-surface px-6 py-5">
            <div className="text-[13px] text-graphite">The story this application tells</div>
            <blockquote className="mt-2 border-l-2 border-jade pl-4 font-display text-[19px] leading-relaxed text-ink">{strategy.content.positioning.primary}</blockquote>
            <p className="mt-3 text-sm leading-relaxed text-graphite">{strategy.content.positioning.narrative}</p>
            <Link to={`/applications/${id}/strategy`} className="mt-3 inline-flex items-center gap-1 text-[13px] font-medium text-cobalt hover:underline">
              Full strategy <LuArrowRight className="size-3.5" />
            </Link>
          </section>
        )}

        <Panel title="Application materials" bodyClassName="py-1">
          <div className="divide-y divide-rule">
            <MaterialRow
              icon={<LuFileText />}
              label="Resume"
              href={`/applications/${id}/resume`}
              status={!resume ? 'Not started' : resumeBlockers ? `${resumeBlockers} issue${resumeBlockers === 1 ? '' : 's'}` : resume.status === 'approved' ? 'Approved' : 'Draft'}
              tone={!resume ? 'neutral' : resumeBlockers ? 'brick' : resume.status === 'approved' ? 'jade' : 'ochre'}
              detail={resume ? `Version ${resume.version}, ATS ${resume.content.ats.score}/100, ${BASE_DECISION_SHORT[resume.content.baseDecision.decision] ?? 'built from your evidence'}` : 'Built from the strategy and your evidence'}
            />
            <MaterialRow
              icon={<LuMail />}
              label="Cover letter"
              href={`/applications/${id}/cover-letter`}
              status={!letter ? 'Not started' : letter.status === 'approved' ? 'Approved' : 'Draft'}
              tone={!letter ? 'neutral' : letter.status === 'approved' ? 'jade' : 'ochre'}
              detail={letter ? `Version ${letter.version}, ${letter.content.wordCount} words, writing ${letter.content.writing.score}/100` : 'Tailored to the company research'}
            />
            <MaterialRow
              icon={<LuListChecks />}
              label="Application questions"
              href={`/applications/${id}/questions`}
              status={!data.questions.length ? 'None' : approvedAnswers === data.questions.length ? 'Approved' : `${approvedAnswers}/${data.questions.length} approved`}
              tone={!data.questions.length ? 'neutral' : approvedAnswers === data.questions.length ? 'jade' : 'ochre'}
              detail={data.questions.length ? `${answered} of ${data.questions.length} drafted${data.questions.some((q) => q.sensitive) ? ', includes sensitive questions' : ''}` : 'Add questions from the application form'}
            />
            <MaterialRow
              icon={<LuScale />}
              label="Readiness review"
              href={`/applications/${id}/review`}
              status={review ? `${review.content.overall}/100` : 'Not started'}
              tone={!review ? 'neutral' : review.content.verdict === 'ready' ? 'jade' : review.content.verdict === 'almost_ready' ? 'ochre' : 'brick'}
              detail={review ? review.content.verdictReason : 'A final check from a recruiter’s point of view'}
            />
          </div>
        </Panel>
      </div>

      <aside className="flex flex-col gap-6">
        <section className="rounded-panel border border-ink bg-ink px-5 py-4 text-white">
          <div className="text-[12.5px] text-white/60">Next step</div>
          <p className="mt-1 text-[15px] leading-snug">{next.text}</p>
          {next.href && (
            <Link to={next.href} className="mt-3 inline-flex items-center gap-1 text-[13px] font-medium text-white hover:underline">
              {next.cta} <LuArrowRight className="size-3.5" />
            </Link>
          )}
        </section>
        <section className="rounded-panel border border-rule bg-surface px-5 py-4 text-[13px]">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
            <dt className="text-graphite">Stage</dt>
            <dd className="text-ink">{STAGE_LABEL[app.stage]}</dd>
            <dt className="text-graphite">Applied</dt>
            <dd className="text-ink">{app.dateApplied ? formatDate(app.dateApplied) : 'Not yet'}</dd>
            <dt className="text-graphite">Research</dt>
            <dd className="text-ink">{RESEARCH_DEPTH_LABEL[app.researchDepth]}</dd>
            <dt className="text-graphite">Added</dt>
            <dd className="text-ink">{formatDate(app.createdAt)}</dd>
          </dl>
        </section>
        <section>
          <h3 className="mb-2 text-[13px] font-medium text-ink">Recent activity</h3>
          <ol className="flex flex-col gap-2.5">
            {data.events.slice(0, 6).map((e) => (
              <li key={e.id} className="flex gap-2.5 text-[13px]">
                <LuCheck className="mt-0.5 size-3.5 shrink-0 text-mist" />
                <span className="min-w-0">
                  <span className="text-ink-soft">{e.title}</span>
                  <span className="block text-[12px] text-mist">{relativeTime(e.occurredAt)}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>
      </aside>
    </div>
  );
}
