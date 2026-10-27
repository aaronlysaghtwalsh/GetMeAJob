import type { App } from '../../app';
import * as brainRepo from '../../repos/brain';
import { getPreferences } from '../../repos/preferences';
import { USABLE_PROVENANCE } from '../../../shared/constants';

export interface ReadinessItem {
  key: string;
  label: string;
  detail: string;
  status: 'done' | 'todo' | 'recommended';
  required: boolean;
  href: string;
}

export interface Readiness {
  items: ReadinessItem[];
  requiredRemaining: number;
  recommendedRemaining: number;
  ready: boolean;
  headline: string;
}

/** Deterministic checklist: what the system needs before it can optimize applications well. */
export function computeReadiness(app: App, userId: string): Readiness {
  const brain = brainRepo.getBrain(app.db, userId);
  const prefs = getPreferences(app.db, userId);
  const docs = brainRepo.listDocuments(app.db, userId);
  const openQuestions = brainRepo.listQuestions(app.db, userId, ['open']);
  const usable = brain.evidence.filter((e) => !e.hidden && USABLE_PROVENANCE.includes(e.provenance));
  const conflicts = openQuestions.filter((q) => q.category === 'conflict');
  const wa = prefs.workAuthorization;
  const resumes = docs.filter((d) => d.kind === 'resume');

  const items: ReadinessItem[] = [
    {
      key: 'resume',
      label: 'Upload your resume',
      detail: resumes.length ? `${resumes.length} resume${resumes.length === 1 ? '' : 's'} on file` : 'Upload one or more resumes to build your Career Brain.',
      status: docs.some((d) => d.kind === 'resume' && d.includedInBrain) ? 'done' : 'todo',
      required: true,
      href: '/brain/documents',
    },
    {
      key: 'evidence',
      label: 'Career Brain has enough evidence',
      detail: `${usable.length} usable evidence item${usable.length === 1 ? '' : 's'} across ${brain.experiences.length} role${brain.experiences.length === 1 ? '' : 's'}`,
      status: usable.length >= 5 && brain.experiences.length >= 1 ? 'done' : 'todo',
      required: true,
      href: '/brain',
    },
    {
      key: 'conflicts',
      label: 'Resolve differences between your documents',
      detail: conflicts.length ? `${conflicts.length} difference${conflicts.length === 1 ? '' : 's'} to confirm` : 'No conflicting details found',
      status: conflicts.length ? 'todo' : 'done',
      required: true,
      href: '/brain/questions',
    },
    {
      key: 'targets',
      label: 'Tell us what roles you want',
      detail: prefs.targetRoles.length ? prefs.targetRoles.slice(0, 4).join(', ') : 'Target roles shape fit scoring and positioning.',
      status: prefs.targetRoles.length ? 'done' : 'todo',
      required: true,
      href: '/brain/preferences',
    },
    {
      key: 'work_authorization',
      label: 'Confirm work authorization and sponsorship',
      detail:
        wa.authorizedToWork && wa.requiresSponsorshipNow
          ? `Authorized: ${wa.authorizedToWork}; sponsorship needed: ${wa.requiresSponsorshipNow}`
          : 'Needed to flag roles you cannot accept and to answer screening questions correctly.',
      status: wa.authorizedToWork && wa.requiresSponsorshipNow ? 'done' : 'todo',
      required: true,
      href: '/brain/preferences',
    },
    {
      key: 'location',
      label: 'Set location and work model',
      detail: prefs.locations.length || prefs.workModels.length ? [...prefs.locations, ...prefs.workModels].join(', ') : 'Where you can work and how (on-site, hybrid, remote).',
      status: prefs.locations.length || prefs.workModels.includes('remote') ? 'done' : 'todo',
      required: true,
      href: '/brain/preferences',
    },
    {
      key: 'metrics',
      label: 'Add numbers to your strongest work',
      detail: `${brain.stats.withMetrics} evidence item${brain.stats.withMetrics === 1 ? '' : 's'} include a measurable result`,
      status: brain.stats.withMetrics >= 3 ? 'done' : 'recommended',
      required: false,
      href: '/brain/questions',
    },
    {
      key: 'compensation',
      label: 'Set a salary range',
      detail: prefs.compensation.minimum || prefs.compensation.target ? 'Range saved' : 'Lets fit analysis flag under-paying roles and answer salary questions consistently.',
      status: prefs.compensation.minimum || prefs.compensation.target ? 'done' : 'recommended',
      required: false,
      href: '/brain/preferences',
    },
    {
      key: 'availability',
      label: 'Set your availability',
      detail: prefs.availability.availableFrom ? `From ${prefs.availability.availableFrom}` : 'When you can start.',
      status: prefs.availability.availableFrom ? 'done' : 'recommended',
      required: false,
      href: '/brain/preferences',
    },
    {
      key: 'voice',
      label: 'Share a writing sample',
      detail: prefs.writingSample ? 'Sample saved; drafts will follow your style' : 'Helps cover letters and answers sound like you.',
      status: prefs.writingSample ? 'done' : 'recommended',
      required: false,
      href: '/brain/preferences',
    },
  ];
  const requiredRemaining = items.filter((i) => i.required && i.status !== 'done').length;
  const recommendedRemaining = items.filter((i) => !i.required && i.status !== 'done').length;
  let headline: string;
  if (!docs.length) headline = 'Start by uploading your resume. Everything else builds on it.';
  else if (requiredRemaining === 0)
    headline = recommendedRemaining ? `Ready to build applications. ${recommendedRemaining} optional step${recommendedRemaining === 1 ? '' : 's'} would make them stronger.` : 'Your Career Brain is ready.';
  else headline = `${requiredRemaining} more step${requiredRemaining === 1 ? '' : 's'} before applications can be tailored properly.`;
  return { items, requiredRemaining, recommendedRemaining, ready: requiredRemaining === 0, headline };
}
