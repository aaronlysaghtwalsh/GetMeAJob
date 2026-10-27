import { LuCircleCheck } from 'react-icons/lu';
import { PageHeader } from '../components/ui/primitives';

const PHASES = [
  {
    phase: 'Phase 1',
    title: 'Core application engine',
    status: 'Available now',
    items: [
      'Accounts, encrypted storage, export and deletion',
      'Career Brain from multiple resumes, with verified evidence and conflict detection',
      'Discovery interview and preferences, including work authorization',
      'Job analysis from pasted text or supported job links',
      'Cited company research (fact, interpretation, hypothesis)',
      'Fit analysis with guardrails, including when not to apply',
      'Application strategy, then resume, cover letter and answers built from it',
      'Integrity checks, ATS parse-back, readiness review, versions and approvals',
      'Application tracker with stages, timeline, contacts and notes',
    ],
  },
  {
    phase: 'Phase 2',
    title: 'Job discovery',
    status: 'Planned',
    items: ['Connectors for public job boards and ATS feeds', 'Normalization and de-duplication across sources', 'Discovery page ranked by fit, preference and effort', 'Saved searches and alerts with a one-click "Build application"'],
  },
  {
    phase: 'Phase 3',
    title: 'Interview intelligence',
    status: 'Planned',
    items: ['Preparation generated when an application advances', 'Company- and role-specific question banks', 'Mock interviews, one question at a time, with feedback'],
  },
  {
    phase: 'Phase 4',
    title: 'Automation with approval',
    status: 'Planned',
    items: ['Browser assistance that maps application fields to your Career Brain', 'Sensitive fields always confirmed by you', 'Networking messages and reminders', 'Nothing is ever submitted without your explicit approval'],
  },
  {
    phase: 'Phase 5',
    title: 'Learning from outcomes',
    status: 'Planned',
    items: ['Which roles, strategies and resume versions earn interviews', 'Conclusions only once there is enough data', 'Career strategy recommendations'],
  },
];

export function RoadmapPage() {
  return (
    <div className="max-w-3xl">
      <PageHeader title="Roadmap" description="What GetMeAJob does today, and what is coming. Planned features are not shown anywhere else in the app until they work." />
      <ol className="flex flex-col gap-4">
        {PHASES.map((p, i) => (
          <li key={p.phase} className={i === 0 ? 'rounded-panel border border-jade/30 bg-surface px-6 py-5' : 'rounded-panel border border-rule bg-surface/60 px-6 py-5'}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-[15px] font-semibold text-ink">
                <span className="mr-2 text-graphite">{p.phase}</span>
                {p.title}
              </h2>
              <span className={i === 0 ? 'text-[13px] font-medium text-jade-strong' : 'text-[13px] text-graphite'}>{p.status}</span>
            </div>
            <ul className="mt-3 flex flex-col gap-1.5">
              {p.items.map((it) => (
                <li key={it} className="flex gap-2 text-sm text-ink-soft">
                  {i === 0 ? <LuCircleCheck className="mt-0.5 size-4 shrink-0 text-jade" /> : <span className="mt-2 size-1 shrink-0 rounded-full bg-mist" />}
                  {it}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  );
}
