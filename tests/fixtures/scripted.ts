/**
 * Deterministic AI responses for the fictional applicant in persona.ts. Each handler reads the
 * real prompt (refs like E3, X1, S2 are discovered from it), so tests exercise the genuine
 * prompt-building, ref-mapping, integrity and rendering code paths.
 */
import type { ScriptedProvider } from '../../src/server/ai/scripted';

function between(text: string, start: string, end: string): string {
  const i = text.indexOf(start);
  if (i < 0) return '';
  const j = text.indexOf(end, i + start.length);
  return text.slice(i + start.length, j < 0 ? undefined : j);
}

/** Find the first [PREFIX#] ref on a line matching the pattern. */
function ref(prompt: string, prefix: string, pattern: RegExp): string {
  for (const line of prompt.split('\n')) {
    const m = line.match(new RegExp(`\\[(${prefix}\\d+)\\]`));
    if (m && pattern.test(line)) return m[1];
  }
  return '';
}

function refs(prompt: string, prefix: string, ...patterns: RegExp[]): string[] {
  return patterns.map((p) => ref(prompt, prefix, p)).filter(Boolean);
}

const A_EXTRACTION = {
  documentType: 'resume',
  person: {
    fullName: 'Jordan Rivera',
    email: 'jordan.rivera@example.com',
    phone: '(312) 555-0187',
    location: 'Chicago, IL',
    headline: '',
    links: [{ label: 'LinkedIn', url: 'linkedin.com/in/jordanrivera-example' }],
  },
  experiences: [
    {
      ref: 'X1',
      kind: 'internship',
      organization: 'Lakeshore Retail Group',
      title: 'Data Analytics Intern',
      location: 'Chicago, IL',
      startDate: '2025-06',
      endDate: '2025-08',
      isCurrent: false,
      employmentType: '',
      summary: '',
      quote: 'Lakeshore Retail Group — Data Analytics Intern',
    },
    {
      ref: 'X2',
      kind: 'part_time',
      organization: 'Campus Rec Center',
      title: 'Student Supervisor',
      location: 'Chicago, IL',
      startDate: '2023-09',
      endDate: '2025-05',
      isCurrent: false,
      employmentType: 'Part-time',
      summary: '',
      quote: 'Campus Rec Center — Student Supervisor',
    },
  ],
  education: [
    {
      ref: 'D1',
      institution: 'University of Illinois Chicago',
      degree: 'B.S.',
      field: 'Data Science',
      minor: 'Business Administration',
      location: 'Chicago, IL',
      startDate: '2022-08',
      endDate: '2026-05',
      grade: 'GPA 3.6/4.0',
      coursework: ['Statistical Learning', 'Database Systems', 'Data Visualization', 'Consumer Behavior'],
      honors: [],
      quote: 'University of Illinois Chicago — B.S. in Data Science, minor in Business Administration',
    },
  ],
  projects: [
    {
      ref: 'P1',
      name: 'Customer Churn Analysis',
      context: 'Capstone',
      role: '',
      startDate: '',
      endDate: '',
      url: '',
      summary: 'Churn model on subscription data for a local gym chain.',
      technologies: ['Python', 'scikit-learn'],
      quote: 'Customer Churn Analysis (Capstone) — Python, scikit-learn',
    },
  ],
  evidence: [
    {
      statement: 'Analyzed 250,000+ rows of point-of-sale and inventory data in Python and SQL to identify slow-moving products across 40 stores',
      quote: 'Analyzed 250,000+ rows of point-of-sale and inventory data in Python and SQL to identify slow-moving products across 40 stores',
      kind: 'achievement',
      themes: ['analytical', 'technical'],
      subjectRef: 'X1',
      metrics: [
        { value: '250,000+', unit: 'rows', context: 'point-of-sale and inventory data analyzed' },
        { value: '40', unit: 'stores', context: 'stores covered by the analysis' },
      ],
      skills: ['Python', 'SQL'],
    },
    {
      statement: 'Built Tableau dashboards used by regional managers in weekly performance reviews',
      quote: 'Built Tableau dashboards used by regional managers in weekly performance reviews',
      kind: 'achievement',
      themes: ['analytical', 'stakeholder'],
      subjectRef: 'X1',
      metrics: [],
      skills: ['Tableau'],
    },
    {
      statement: 'Presented markdown recommendations to the VP of Merchandising and two category directors',
      quote: 'Presented markdown recommendations to the VP of Merchandising and two category directors',
      kind: 'presentation',
      themes: ['communication', 'stakeholder'],
      subjectRef: 'X1',
      metrics: [],
      skills: ['Stakeholder presentations'],
    },
    {
      statement: 'Supervised a team of 8 student staff across evening shifts',
      quote: 'Supervised a team of 8 student staff across evening shifts',
      kind: 'leadership',
      themes: ['leadership', 'operations'],
      subjectRef: 'X2',
      metrics: [{ value: '8', unit: 'student staff', context: 'team size supervised' }],
      skills: [],
    },
    {
      statement: 'Resolved member issues and handled 30+ front-desk inquiries per shift',
      quote: 'Resolved member issues and handled 30+ front-desk inquiries per shift',
      kind: 'responsibility',
      themes: ['customer_facing', 'problem_solving'],
      subjectRef: 'X2',
      metrics: [{ value: '30+', unit: 'inquiries per shift', context: 'front-desk volume' }],
      skills: [],
    },
    {
      statement: 'Built a churn model on 12 months of subscription data for a local gym chain and presented findings to the owner',
      quote: 'Built a churn model on 12 months of subscription data for a local gym chain and presented findings to the owner',
      kind: 'project',
      themes: ['analytical', 'technical', 'communication'],
      subjectRef: 'P1',
      metrics: [{ value: '12', unit: 'months', context: 'subscription data used' }],
      skills: ['Python', 'scikit-learn'],
    },
  ],
  skills: [
    { name: 'Python', category: 'technical', quote: 'Python, SQL, Tableau, Excel, scikit-learn' },
    { name: 'SQL', category: 'technical', quote: 'Python, SQL, Tableau, Excel, scikit-learn' },
    { name: 'Tableau', category: 'tool', quote: 'Python, SQL, Tableau, Excel, scikit-learn' },
    { name: 'Excel', category: 'tool', quote: 'Python, SQL, Tableau, Excel, scikit-learn' },
    { name: 'scikit-learn', category: 'technical', quote: 'Python, SQL, Tableau, Excel, scikit-learn' },
    { name: 'Data visualization', category: 'analytical', quote: 'Data visualization, Stakeholder presentations' },
    { name: 'Stakeholder presentations', category: 'communication', quote: 'Data visualization, Stakeholder presentations' },
  ],
  resume: {
    isResume: true,
    focus: 'Analytics-focused; leads with education and the Lakeshore internship.',
    sections: [
      { title: 'EDUCATION', kind: 'education', subjectRefs: ['D1'] },
      { title: 'EXPERIENCE', kind: 'experience', subjectRefs: ['X1', 'X2'] },
      { title: 'PROJECTS', kind: 'projects', subjectRefs: ['P1'] },
      { title: 'SKILLS', kind: 'skills', subjectRefs: [] },
    ],
  },
  notes: [],
};

const B_EXTRACTION = {
  documentType: 'resume',
  person: { fullName: 'Jordan Rivera', email: 'jordan.rivera@example.com', phone: '(312) 555-0187', location: 'Chicago, IL', headline: '', links: [] },
  experiences: [
    {
      ref: 'X1',
      kind: 'part_time',
      organization: 'Fizzwell Beverages',
      title: 'Brand Ambassador',
      location: 'Chicago, IL',
      startDate: '2023-01',
      endDate: '',
      isCurrent: true,
      employmentType: '',
      summary: '',
      quote: 'Brand Ambassador, Fizzwell Beverages — Chicago, IL (Jan 2023 – Present)',
    },
    {
      ref: 'X2',
      kind: 'internship',
      organization: 'Lakeshore Retail',
      title: 'Data Analytics Intern',
      location: 'Chicago, IL',
      startDate: '2025',
      endDate: '2025',
      isCurrent: false,
      employmentType: '',
      summary: '',
      quote: 'Data Analytics Intern, Lakeshore Retail — Chicago, IL (Summer 2025)',
    },
    {
      ref: 'X3',
      kind: 'part_time',
      organization: 'Campus Rec Center',
      title: 'Student Supervisor',
      location: 'Chicago, IL',
      startDate: '2023',
      endDate: '2024',
      isCurrent: false,
      employmentType: '',
      summary: '',
      quote: 'Student Supervisor, Campus Rec Center — Chicago, IL (2023 – 2024)',
    },
    {
      ref: 'X4',
      kind: 'leadership',
      organization: 'UIC Club Soccer',
      title: 'Captain',
      location: 'Chicago, IL',
      startDate: '2023',
      endDate: '2026',
      isCurrent: false,
      employmentType: '',
      summary: '',
      quote: 'Captain, UIC Club Soccer — Chicago, IL (2023 – 2026)',
    },
  ],
  education: [
    {
      ref: 'D1',
      institution: 'University of Illinois Chicago',
      degree: 'B.S.',
      field: 'Data Science',
      minor: '',
      location: '',
      startDate: '',
      endDate: '2026-05',
      grade: '',
      coursework: [],
      honors: [],
      quote: 'University of Illinois Chicago, B.S. Data Science (expected May 2026)',
    },
  ],
  projects: [],
  evidence: [
    {
      statement: 'Represented the brand at 60+ campus and community events',
      quote: 'Represented the brand at 60+ campus and community events',
      kind: 'responsibility',
      themes: ['customer_facing', 'communication'],
      subjectRef: 'X1',
      metrics: [{ value: '60+', unit: 'events', context: 'campus and community events worked' }],
      skills: ['Event marketing'],
    },
    {
      statement: 'Grew event sign-ups 35% semester over semester by redesigning the sampling booth flow',
      quote: 'Grew event sign-ups 35% semester over semester by redesigning the sampling booth flow',
      kind: 'achievement',
      themes: ['sales', 'problem_solving', 'initiative'],
      subjectRef: 'X1',
      metrics: [{ value: '35%', unit: 'percent', context: 'semester-over-semester growth in event sign-ups' }],
      skills: [],
    },
    {
      statement: 'Trained 5 new ambassadors on product messaging',
      quote: 'Trained 5 new ambassadors on product messaging',
      kind: 'leadership',
      themes: ['leadership', 'communication'],
      subjectRef: 'X1',
      metrics: [{ value: '5', unit: 'ambassadors', context: 'new ambassadors trained' }],
      skills: [],
    },
    {
      statement: 'Built Tableau dashboards for regional managers',
      quote: 'Built Tableau dashboards for regional managers',
      kind: 'achievement',
      themes: ['analytical', 'stakeholder'],
      subjectRef: 'X2',
      metrics: [],
      skills: ['Tableau'],
    },
    {
      statement: 'Analyzed 250k rows of sales data to flag slow-moving stock',
      quote: 'Analyzed 250k rows of sales data to flag slow-moving stock',
      kind: 'achievement',
      themes: ['analytical'],
      subjectRef: 'X2',
      metrics: [{ value: '250k', unit: 'rows', context: 'sales data analyzed' }],
      skills: [],
    },
    {
      statement: 'Led evening shifts and handled member questions',
      quote: 'Led evening shifts and handled member questions',
      kind: 'responsibility',
      themes: ['customer_facing', 'leadership'],
      subjectRef: 'X3',
      metrics: [],
      skills: [],
    },
    {
      statement: 'Led a 24-player club team and organized travel for 6 away tournaments',
      quote: 'Led a 24-player club team and organized travel for 6 away tournaments',
      kind: 'leadership',
      themes: ['leadership', 'teamwork', 'operations'],
      subjectRef: 'X4',
      metrics: [
        { value: '24', unit: 'players', context: 'club team size' },
        { value: '6', unit: 'tournaments', context: 'away tournaments organized' },
      ],
      skills: [],
    },
  ],
  skills: [
    { name: 'Client relationships', category: 'customer', quote: 'Client relationships, Event marketing, Public speaking' },
    { name: 'Event marketing', category: 'business', quote: 'Client relationships, Event marketing, Public speaking' },
    { name: 'Public speaking', category: 'communication', quote: 'Client relationships, Event marketing, Public speaking' },
    { name: 'Python', category: 'technical', quote: 'Python, SQL, Tableau, HubSpot' },
    { name: 'SQL', category: 'technical', quote: 'Python, SQL, Tableau, HubSpot' },
    { name: 'Tableau', category: 'tool', quote: 'Python, SQL, Tableau, HubSpot' },
    { name: 'HubSpot', category: 'tool', quote: 'Python, SQL, Tableau, HubSpot' },
  ],
  resume: {
    isResume: true,
    focus: 'Client-facing; leads with the Fizzwell brand ambassador role and sales results.',
    sections: [
      { title: 'PROFILE', kind: 'summary', subjectRefs: [] },
      { title: 'EXPERIENCE', kind: 'experience', subjectRefs: ['X1', 'X2', 'X3', 'X4'] },
      { title: 'EDUCATION', kind: 'education', subjectRefs: ['D1'] },
      { title: 'SKILLS', kind: 'skills', subjectRefs: [] },
    ],
  },
  notes: ['Lakeshore internship listed as "Summer 2025" without months.'],
};

const JOB_INTEL = {
  title: 'Customer Insights Analyst',
  company: 'Northwind Analytics',
  team: 'Client Success',
  location: 'Chicago, IL',
  workModel: 'hybrid',
  employmentType: 'Full-time',
  seniority: 'entry',
  salary: { text: '$68,000 – $80,000 per year plus annual bonus', min: 68000, max: 80000, currency: 'USD', period: 'year' },
  summary: 'Turns retail clients’ point-of-sale, loyalty and inventory data into dashboards and recommendations, and presents them to category managers. Works with account managers on quarterly business reviews and renewals.',
  responsibilities: [
    { text: 'Analyze point-of-sale, loyalty and inventory data to answer client questions', importance: 'core' },
    { text: 'Build and maintain Tableau or Power BI dashboards for client stakeholders', importance: 'core' },
    { text: 'Present insights and recommendations to non-technical audiences', importance: 'core' },
    { text: 'Work with account managers to prepare quarterly business reviews', importance: 'secondary' },
    { text: 'Document analyses and share best practices', importance: 'secondary' },
  ],
  requirements: [
    { id: 'R1', text: "Bachelor's degree in a quantitative field", type: 'required', category: 'education', keywords: ['data science', 'statistics', 'economics'] },
    { id: 'R2', text: 'Proficiency in SQL and Python for data analysis', type: 'required', category: 'skill', keywords: ['SQL', 'Python'] },
    { id: 'R3', text: 'Experience with Tableau or Power BI', type: 'required', category: 'skill', keywords: ['Tableau', 'Power BI'] },
    { id: 'R4', text: 'Strong communication skills and comfort presenting to stakeholders', type: 'required', category: 'skill', keywords: ['communication', 'presenting', 'stakeholders'] },
    { id: 'R5', text: '0-2 years of experience in analytics, consulting or a client-facing role', type: 'required', category: 'experience', keywords: ['analytics', 'client-facing'] },
    { id: 'R6', text: 'Retail or consumer goods experience', type: 'preferred', category: 'experience', keywords: ['retail', 'consumer goods'] },
    { id: 'R7', text: 'Experience in a client-facing or sales role', type: 'preferred', category: 'experience', keywords: ['client-facing', 'sales'] },
    { id: 'R8', text: 'Familiarity with Salesforce or another CRM', type: 'preferred', category: 'skill', keywords: ['Salesforce', 'CRM'] },
  ],
  skills: { technical: ['SQL', 'Python'], tools: ['Tableau', 'Power BI', 'Salesforce'], soft: ['Communication', 'Presenting'], domain: ['Retail analytics', 'Loyalty programs'] },
  education: "Bachelor's degree in a quantitative field",
  experienceYears: '0-2 years',
  customerFacing: { level: 'heavy', basis: 'Presents to client category managers; partners with account managers on QBRs and renewals.' },
  travel: '',
  sponsorship: { stance: 'not_offered', quote: 'Northwind is unable to sponsor employment visas for this position.' },
  startDate: '',
  deadline: '',
  keywords: [
    { term: 'SQL', weight: 'high', variants: [] },
    { term: 'Python', weight: 'high', variants: [] },
    { term: 'Tableau', weight: 'high', variants: ['Power BI'] },
    { term: 'dashboards', weight: 'high', variants: ['dashboard'] },
    { term: 'stakeholders', weight: 'high', variants: ['stakeholder'] },
    { term: 'retail', weight: 'medium', variants: [] },
    { term: 'point-of-sale', weight: 'medium', variants: ['POS'] },
    { term: 'presentations', weight: 'medium', variants: ['presented', 'presenting'] },
    { term: 'client-facing', weight: 'medium', variants: ['client'] },
    { term: 'Salesforce', weight: 'low', variants: ['CRM'] },
    { term: 'loyalty', weight: 'low', variants: [] },
  ],
  screeningCriteria: [
    { criterion: "Bachelor's degree in a quantitative field", why: 'Listed first under requirements.' },
    { criterion: 'SQL and Python', why: 'Core tools for the analysis work.' },
    { criterion: 'Authorized to work in the US without sponsorship', why: 'The posting says sponsorship is not available.' },
  ],
  coreCompetencies: ['Retail data analysis', 'Dashboarding', 'Presenting to clients'],
  hiddenPriorities: [
    { insight: 'They want analysts who can help account managers retain clients, not just build reports.', basis: '"partner with account managers on renewals"', confidence: 'medium' },
    { insight: 'Comfort with non-technical retail audiences matters as much as technical skill.', basis: '"present findings to retail category managers"', confidence: 'high' },
  ],
  redFlags: [],
  companyWebsite: '',
};

export function registerFixtures(p: ScriptedProvider | undefined): void {
  if (!p) throw new Error('Scripted provider is not active');

  p.on('transcript', () => ({ text: 'Transcribed text', notes: '' }));

  p.on('career_extraction', (_req, prompt) => {
    const doc = between(prompt, '<document>', '</document>');
    if (doc.includes('Fizzwell')) return B_EXTRACTION;
    return A_EXTRACTION;
  });

  p.on('merge_plan', (_req, prompt) => {
    const items = between(prompt, '## Newly extracted items', '\u0000');
    const lines = items.split('\n').filter((l) => l.startsWith('[D'));
    const parse = (type: string) =>
      lines
        .filter((l) => l.includes(`] ${type}`))
        .map((l) => ({ ref: l.match(/^\[([^\]]+)\]/)![1], text: l }));
    const exps = parse('experience:');
    const cluster = (pred: (t: string) => boolean) => exps.filter((e) => pred(e.text)).map((e) => e.ref);
    const lakeshore = cluster((t) => /Lakeshore/.test(t));
    const campus = cluster((t) => /Campus Rec/.test(t));
    const ev = parse('evidence');
    const evCluster = (re: RegExp) => ev.filter((e) => re.test(e.text)).map((e) => e.ref);
    const rows = evCluster(/250(,000|k)/);
    const tableau = evCluster(/Built Tableau dashboards/);
    const campusA = campus.find((r) => exps.find((e) => e.ref === r)!.text.includes('2025-05')) ?? campus[0];
    return {
      experienceClusters: [
        { refs: lakeshore, existingId: '', preferredRef: lakeshore.find((r) => exps.find((e) => e.ref === r)!.text.includes('Group')) ?? lakeshore[0] },
        { refs: campus, existingId: '', preferredRef: campusA },
      ].filter((c) => c.refs.length),
      educationClusters: [{ refs: parse('education:').map((e) => e.ref), existingId: '', preferredRef: parse('education:').find((e) => e.text.includes('Data Science'))?.ref ?? '' }],
      projectClusters: [],
      evidenceClusters: [
        { refs: rows, existingId: '', preferredRef: rows.find((r) => ev.find((e) => e.ref === r)!.text.includes('250,000+')) ?? rows[0], mergedStatement: '' },
        { refs: tableau, existingId: '', preferredRef: tableau.find((r) => ev.find((e) => e.ref === r)!.text.includes('weekly')) ?? tableau[0], mergedStatement: '' },
      ].filter((c) => c.refs.length),
      conflicts:
        campus.length > 1
          ? [
              {
                topic: 'Campus Rec end date',
                detail: 'One resume says you were Student Supervisor at Campus Rec Center until May 2025; the other says 2024.',
                question: 'When did your Student Supervisor role at Campus Rec Center end: May 2025 or sometime in 2024?',
                targetRef: campusA,
                field: 'endDate',
                options: ['May 2025', '2024'],
              },
            ]
          : [],
    };
  });

  p.on('discovery_plan', (_req, prompt) => ({
    summary: 'Strong analytics evidence from the Lakeshore internship and real client-facing work at Fizzwell. Missing: outcomes of the Lakeshore recommendations and the scale of conversations at events.',
    readyForApplications: true,
    questions: [
      {
        question: 'At Lakeshore, were any of your markdown recommendations adopted? If so, what changed?',
        rationale: 'An adopted recommendation turns analysis into impact, which is what analyst hiring managers screen for.',
        category: 'achievement',
        priority: 90,
        targetRef: ref(prompt, 'X', /Lakeshore/),
        answerType: 'text',
        choices: [],
      },
      {
        question: 'At a typical Fizzwell event, roughly how many people did you speak with?',
        rationale: 'A concrete number shows the scale of your client-facing experience.',
        category: 'metric',
        priority: 75,
        targetRef: ref(prompt, 'X', /Fizzwell/),
        answerType: 'number',
        choices: [],
      },
      {
        question: 'Did the gym owner act on anything from your churn analysis?',
        rationale: 'Outcomes make the capstone read like real work, not coursework.',
        category: 'project',
        priority: 60,
        targetRef: ref(prompt, 'P', /Churn/),
        answerType: 'text',
        choices: [],
      },
    ],
  }));

  p.on('answer_integration', (_req, prompt) => {
    const answer = between(prompt, '<answer>', '</answer>').trim();
    const num = answer.match(/\d[\d,]*%?/);
    const target = prompt.match(/Question \(about (\w+)\)/)?.[1] ?? '';
    return {
      newEvidence: num
        ? [
            {
              statement: answer.replace(/\.$/, ''),
              kind: 'achievement',
              themes: ['analytical', 'stakeholder'],
              subjectRef: target,
              metrics: [{ value: num[0], unit: '', context: 'stated by applicant' }],
              skills: [],
              excerpt: answer,
            },
          ]
        : [],
      fieldUpdates: /May 2025/i.test(answer) && /Campus Rec/.test(prompt) ? [{ targetRef: target, field: 'endDate', value: '2025-05' }] : [],
      newSkills: [],
      followUp: '',
    };
  });

  p.on('job_intelligence', () => JOB_INTEL);

  p.on('research', () => ({
    __research: true,
    queries: ['Northwind Analytics retail analytics', 'Northwind Analytics customers loyalty', 'Northwind Analytics news 2026'],
    searchResults: [
      { url: 'https://northwind-analytics.example/about', title: 'About Northwind Analytics', pageAge: '' },
      { url: 'https://northwind-analytics.example/news/loyalty-launch', title: 'Northwind launches Loyalty Insights', pageAge: 'March 2026' },
      { url: 'https://retailwire.example/northwind-series-b', title: 'Northwind Analytics raises Series B', pageAge: 'January 2026' },
    ],
    segments: [
      { text: '## Company overview\nNorthwind Analytics sells retail analytics software to mid-sized grocery and specialty retailers.', citations: [{ url: 'https://northwind-analytics.example/about', title: 'About Northwind Analytics', citedText: 'software for mid-sized grocery and specialty retailers' }] },
      { text: ' Customers use it to plan promotions, manage inventory and measure loyalty programs.', citations: [{ url: 'https://northwind-analytics.example/about', title: 'About Northwind Analytics', citedText: 'plan promotions, manage inventory and measure loyalty programs' }] },
      { text: '\n\n## Recent developments\nIn March 2026 Northwind launched Loyalty Insights, a module for measuring loyalty program performance.', citations: [{ url: 'https://northwind-analytics.example/news/loyalty-launch', title: 'Northwind launches Loyalty Insights', citedText: 'launched Loyalty Insights, a new module' }] },
      { text: ' In January 2026 the company raised a $40 million Series B to expand its client success team.', citations: [{ url: 'https://retailwire.example/northwind-series-b', title: 'Northwind Analytics raises Series B', citedText: '$40 million Series B to expand client success' }] },
      { text: '\n\n## Interpretation\nThe Series B focus on client success suggests the Customer Insights team is growing and that retention matters.', citations: [] },
    ],
  }));

  p.on('company_research', (_req, prompt) => {
    const sid = (host: string) => prompt.split('\n').find((l) => l.startsWith('[S') && l.includes(host))?.match(/^\[(S\d+)\]/)?.[1] ?? 'S0';
    const about = sid('northwind-analytics.example/about');
    const launch = sid('loyalty-launch');
    const seriesB = sid('northwind-series-b');
    return {
      overview: 'Northwind Analytics sells retail analytics software to mid-sized grocery and specialty retailers, who use it to plan promotions, manage inventory and measure loyalty programs.',
      findings: [
        { id: 'F1', category: 'customers', claim: 'Northwind serves mid-sized grocery and specialty retailers.', type: 'fact', sourceIds: [about], date: '' },
        { id: 'F2', category: 'products', claim: 'Clients use Northwind to plan promotions, manage inventory and measure loyalty programs.', type: 'fact', sourceIds: [about], date: '' },
        { id: 'F3', category: 'news', claim: 'Northwind launched Loyalty Insights, a module for measuring loyalty program performance, in March 2026.', type: 'fact', sourceIds: [launch], date: '2026-03' },
        { id: 'F4', category: 'funding', claim: 'Northwind raised a $40 million Series B in January 2026 to expand its client success team.', type: 'fact', sourceIds: [seriesB], date: '2026-01' },
        { id: 'F5', category: 'team', claim: 'The Customer Insights Analyst sits on the Client Success team and supports renewals.', type: 'fact', sourceIds: ['S0'], date: '' },
        { id: 'F6', category: 'strategy', claim: 'Client retention is likely a near-term priority given the Series B focus on client success.', type: 'interpretation', sourceIds: [seriesB, 'S0'], date: '' },
      ],
      values: [{ value: 'Practical, client-facing analytics that retailers act on', findingIds: ['F2', 'F5'] }],
      teamSignals: [{ signal: 'Client Success is expanding after the Series B', findingIds: ['F4'] }],
      talkingPoints: [
        { point: 'The new Loyalty Insights module and how loyalty data connects to promotion planning', findingIds: ['F3'] },
        { point: 'Helping account managers show value at renewal time', findingIds: ['F5', 'F6'] },
      ],
      openQuestions: ['How large the Customer Insights team is today.'],
    };
  });

  p.on('fit_analysis', (_req, prompt) => {
    const rows = ref(prompt, 'E', /250,000\+ rows/);
    const tableau = ref(prompt, 'E', /Tableau dashboards used by regional managers/);
    const presented = ref(prompt, 'E', /Presented markdown/);
    const events = ref(prompt, 'E', /60\+ campus/);
    const signups = ref(prompt, 'E', /sign-ups 35%/);
    const degree = ref(prompt, 'D', /Data Science/);
    const lakeshore = ref(prompt, 'X', /Lakeshore/);
    const fizz = ref(prompt, 'X', /Fizzwell/);
    return {
      verdict: {
        tier: 'high_priority',
        headline: 'A strong, realistic match: you have done this exact kind of retail analysis and you have real client-facing experience.',
        rationale:
          'The Lakeshore internship maps directly onto the core work: point-of-sale and inventory analysis, Tableau dashboards for managers and presenting recommendations to senior merchandising leaders. Fizzwell adds genuine client-facing and sales experience, which the posting prefers. The main gap is CRM experience, which is a nice-to-have.',
      },
      dimensions: [
        { key: 'experience', score: 82, basis: 'evidence', assessment: 'One directly relevant retail analytics internship plus sustained client-facing work.', evidenceIds: [lakeshore, fizz].filter(Boolean) },
        { key: 'skills', score: 86, basis: 'evidence', assessment: 'SQL, Python and Tableau are all evidenced in real work.', evidenceIds: [rows, tableau].filter(Boolean) },
        { key: 'education', score: 92, basis: 'evidence', assessment: 'Data Science degree finishing May 2026.', evidenceIds: [degree].filter(Boolean) },
        { key: 'industry', score: 80, basis: 'evidence', assessment: 'Retail experience at Lakeshore and consumer goods at Fizzwell.', evidenceIds: [lakeshore, fizz].filter(Boolean) },
        { key: 'location', score: 95, basis: 'preference', assessment: 'Chicago hybrid matches your stated locations.', evidenceIds: [] },
        { key: 'compensation', score: 75, basis: 'preference', assessment: 'The posted range overlaps your target.', evidenceIds: [] },
        { key: 'work_authorization', score: 100, basis: 'preference', assessment: 'You do not need sponsorship; the posting does not offer it.', evidenceIds: [] },
        { key: 'career_preference', score: 88, basis: 'preference', assessment: 'Customer insights sits squarely in your target mix of data and client work.', evidenceIds: [] },
      ],
      requirementMatches: [
        { requirementId: 'R1', status: 'strong', evidenceIds: [degree].filter(Boolean), explanation: 'B.S. in Data Science.' },
        { requirementId: 'R2', status: 'strong', evidenceIds: [rows].filter(Boolean), explanation: 'Used Python and SQL on 250,000+ rows at Lakeshore.' },
        { requirementId: 'R3', status: 'strong', evidenceIds: [tableau].filter(Boolean), explanation: 'Built Tableau dashboards used weekly by regional managers.' },
        { requirementId: 'R4', status: 'strong', evidenceIds: [presented].filter(Boolean), explanation: 'Presented recommendations to a VP and category directors.' },
        { requirementId: 'R5', status: 'partial', evidenceIds: [lakeshore, fizz].filter(Boolean), explanation: 'Internship-level analytics experience plus client-facing work.' },
        { requirementId: 'R6', status: 'strong', evidenceIds: [rows].filter(Boolean), explanation: 'Retail point-of-sale and inventory analysis.' },
        { requirementId: 'R7', status: 'strong', evidenceIds: [events, signups].filter(Boolean), explanation: 'Brand ambassador at 60+ events; grew sign-ups 35%.' },
        { requirementId: 'R8', status: 'gap', evidenceIds: [], explanation: 'No Salesforce experience in your Career Brain (HubSpot is listed as a skill without supporting evidence of use).' },
      ],
      strengths: [
        { point: 'Has already done retail POS and inventory analysis on a real dataset', evidenceIds: [rows].filter(Boolean) },
        { point: 'Builds dashboards that managers actually use', evidenceIds: [tableau].filter(Boolean) },
        { point: 'Comfortable presenting to senior, non-technical leaders', evidenceIds: [presented].filter(Boolean) },
        { point: 'Proven client-facing energy and a measurable sales result', evidenceIds: [signups].filter(Boolean) },
      ],
      gaps: [
        { point: 'No Salesforce or CRM experience', severity: 'minor', mitigation: 'It is listed as nice-to-have; mention willingness to learn only if asked.' },
        { point: 'Only one analytics role so far', severity: 'moderate', mitigation: 'Lead with the depth of the Lakeshore work and the capstone.' },
      ],
      recruiterView: {
        firstImpression: 'Data Science grad with a retail analytics internship and client-facing experience: an obvious fit for the title.',
        wouldAdvance: 'yes',
        reasoning: 'Keyword and experience match on the core requirements, and the client-facing story differentiates.',
        concerns: [{ concern: 'Is one internship enough analytics depth?', severity: 'moderate', response: 'Show scale (250,000+ rows, 40 stores) and that managers used the dashboards weekly.', evidenceIds: [rows, tableau].filter(Boolean) }],
      },
      hiringManagerView: {
        canDoTheWork: 'likely',
        reasoning: 'The internship work is the same shape as this job; presenting to merchandising leaders is a strong signal for client QBRs.',
        concerns: [{ concern: 'Can they handle client pressure at renewal time?', severity: 'minor', response: 'Fizzwell event work shows composure with the public; the supervisor role shows handling member issues.', evidenceIds: [events].filter(Boolean) }],
      },
      atsView: { risk: 'low', notes: 'Covers SQL, Python, Tableau, dashboards and stakeholder keywords truthfully. Salesforce cannot be claimed.' },
      competitiveness: { level: 'competitive', reasoning: 'Entry-level analyst roles draw many applicants; the combination of real retail analysis and client-facing work is less common than either alone.' },
      effort: { researchMinutes: 10, resumeMinutes: 15, coverLetterMinutes: 20, questionsMinutes: 15, notes: 'Three questions, one sensitive.' },
      alternativeRoles: [{ title: 'Client Analytics / Analytics Consultant', reason: 'Same blend of analysis and client presentation.' }],
    };
  });

  p.on('application_strategy', (_req, prompt) => {
    const rows = ref(prompt, 'E', /250,000\+ rows/);
    const tableau = ref(prompt, 'E', /Tableau dashboards used by regional managers/);
    const presented = ref(prompt, 'E', /Presented markdown/);
    const signups = ref(prompt, 'E', /sign-ups 35%/);
    const events = ref(prompt, 'E', /60\+ campus/);
    const resumeA = ref(prompt, 'A', /Analytics-focused/) || 'A';
    const resumeB = ref(prompt, 'A', /Client-facing/) || 'B';
    const lakeshore = ref(prompt, 'X', /Lakeshore/);
    const fizz = ref(prompt, 'X', /Fizzwell/);
    const campus = ref(prompt, 'X', /Campus Rec/);
    return {
      positioning: {
        primary: 'A data science graduate who has already turned retail POS data into dashboards and recommendations that managers used, and who is comfortable in front of clients.',
        secondary: 'Two years of client-facing brand work with a measurable sales result.',
        narrative: 'Jordan has done the analytical half of this job in a retail setting and the client-facing half at events. Customer Insights is where both meet.',
      },
      leadWith: [
        { point: 'Lakeshore retail analysis at scale', evidenceIds: [rows].filter(Boolean), why: 'Direct match to the core responsibility.' },
        { point: 'Dashboards used weekly by managers', evidenceIds: [tableau].filter(Boolean), why: 'Shows the work was adopted, not just built.' },
        { point: 'Presenting to senior merchandising leaders', evidenceIds: [presented].filter(Boolean), why: 'Mirrors presenting to client category managers.' },
      ],
      deEmphasize: [{ point: 'Campus Rec details', why: 'Less relevant; keep to one line.' }],
      strongestEvidence: [
        { evidenceId: rows, useIn: ['resume', 'answers'], why: 'Scale and tools in one line.' },
        { evidenceId: presented, useIn: ['resume', 'cover_letter', 'interview'], why: 'Best proof of stakeholder communication.' },
        { evidenceId: signups, useIn: ['resume', 'cover_letter'], why: 'Commercial result that supports the renewals angle.' },
      ].filter((e) => e.evidenceId),
      baseResume: { decision: 'combine', sourceIds: [resumeA, resumeB], rationale: 'Resume A has the stronger analytics bullets; Resume B has the client-facing story this team values.' },
      objections: [
        { objection: 'Limited full-time experience', severity: 'moderate', response: 'Lead with the scale and adoption of the Lakeshore work.', evidenceIds: [rows, tableau].filter(Boolean) },
        { objection: 'No CRM experience', severity: 'minor', response: 'Do not claim it; it is a nice-to-have.', evidenceIds: [] },
      ],
      companyPriorities: [
        { priority: 'Client retention and value at renewal', findingIds: ['F4', 'F6'], howToAddress: 'Frame dashboards and presentations as helping stakeholders act.' },
        { priority: 'Loyalty measurement', findingIds: ['F3'], howToAddress: 'Mention genuine interest in loyalty data; no claims of experience with it.' },
      ],
      rolePriorities: [
        { priority: 'Retail data analysis', requirementIds: ['R2', 'R6'], howToAddress: 'Lakeshore bullet with numbers.' },
        { priority: 'Presenting to non-technical stakeholders', requirementIds: ['R4'], howToAddress: 'VP of Merchandising presentation.' },
      ],
      differentiators: [{ point: 'Analytics plus real client-facing experience', evidenceIds: [rows, events].filter(Boolean) }],
      coverLetter: {
        angle: 'I have done both halves of this job; Customer Insights is where they meet.',
        hook: "Northwind's Series B focus on client success, connected to presenting Lakeshore recommendations to merchandising leaders.",
        whyCompany: 'Retail analytics that retailers act on; the new Loyalty Insights module.',
        whyRole: 'Analysis plus presenting to clients.',
        whyMe: 'Lakeshore analysis and dashboards; Fizzwell client-facing results.',
        whyNow: 'Graduating May 2026; the client success team is growing.',
      },
      resumePlan: {
        summaryFocus: 'Retail analytics plus client-facing experience',
        includeSummary: true,
        sectionOrder: ['summary', 'experience', 'projects', 'education', 'skills', 'leadership'],
        experienceOrder: [lakeshore, fizz, campus].filter(Boolean),
        keywordsToCover: [
          { term: 'SQL', evidenceIds: [rows].filter(Boolean) },
          { term: 'Tableau', evidenceIds: [tableau].filter(Boolean) },
          { term: 'stakeholders', evidenceIds: [presented].filter(Boolean) },
        ],
        keywordsNotSupported: ['Salesforce', 'Power BI', 'loyalty'],
      },
      risks: ['Thin evidence for outcomes of the Lakeshore recommendations.'],
      questionsForApplicant: [{ question: 'Were any Lakeshore markdown recommendations adopted?', why: 'An outcome would strengthen the lead bullet.' }],
    };
  });

  p.on('resume_draft', (_req, prompt) => {
    const e = (re: RegExp) => ref(prompt, 'E', re);
    const x = (re: RegExp) => ref(prompt, 'X', re);
    // First draft embellishes ("two years"); the repair pass returns the supported version.
    const repairing = prompt.includes('failed the integrity check');
    return {
      summary: {
        text: repairing
          ? 'Data Science graduate (May 2026) who has analyzed retail point-of-sale data at scale, built Tableau dashboards managers used weekly, and works client-facing events as a brand ambassador.'
          : 'Data Science graduate (May 2026) who has analyzed retail point-of-sale data at scale, built Tableau dashboards managers used weekly, and spent two years in client-facing brand work.',
        evidenceIds: [e(/250,000\+ rows/), e(/Tableau dashboards used by regional/), ref(prompt, 'D', /Data Science/), x(/Fizzwell/)].filter(Boolean),
      },
      sectionOrder: ['summary', 'experience', 'projects', 'education', 'skills', 'leadership'],
      experience: [
        {
          experienceId: x(/Lakeshore/),
          bullets: [
            { text: 'Analyzed 250,000+ rows of point-of-sale and inventory data in Python and SQL to identify slow-moving products across 40 stores', evidenceIds: [e(/250,000\+ rows/)] },
            { text: 'Built Tableau dashboards that regional managers used in weekly performance reviews', evidenceIds: [e(/Tableau dashboards used by regional/)] },
            { text: 'Presented markdown recommendations to the VP of Merchandising and two category directors', evidenceIds: [e(/Presented markdown/)] },
          ],
        },
        {
          experienceId: x(/Fizzwell/),
          bullets: [
            { text: 'Grew event sign-ups 35% semester over semester by redesigning the sampling booth flow', evidenceIds: [e(/sign-ups 35%/)] },
            { text: 'Represented the brand at 60+ campus and community events', evidenceIds: [e(/60\+ campus/)] },
            { text: 'Trained 5 new ambassadors on product messaging', evidenceIds: [e(/Trained 5/)] },
          ],
        },
        {
          experienceId: x(/Campus Rec/),
          bullets: [{ text: 'Supervised 8 student staff and handled 30+ front-desk inquiries per shift', evidenceIds: [e(/Supervised a team of 8/), e(/30\+ front-desk/)] }],
        },
      ],
      projects: [
        {
          projectId: ref(prompt, 'P', /Churn/),
          bullets: [{ text: 'Built a churn model in Python and scikit-learn on 12 months of subscription data and presented findings to the gym owner', evidenceIds: [e(/churn model/)] }],
        },
      ],
      education: [
        {
          educationId: ref(prompt, 'D', /Data Science/),
          details: [{ text: 'Relevant coursework: Statistical Learning, Database Systems, Data Visualization, Consumer Behavior', evidenceIds: [ref(prompt, 'D', /Data Science/)] }],
        },
      ],
      skills: [
        { label: 'Data & analytics', items: ['SQL', 'Python', 'Tableau', 'Excel', 'scikit-learn', 'Data visualization'] },
        { label: 'Client-facing', items: ['Stakeholder presentations', 'Public speaking', 'Client relationships', 'Salesforce'] },
      ],
      leadership: { entries: [{ experienceId: x(/Soccer/), bullets: [{ text: 'Led a 24-player club team and organized travel for 6 away tournaments', evidenceIds: [e(/24-player/)] }] }], lines: [] },
      changeLog: [
        { change: 'Combined Resume A analytics bullets with Resume B client-facing bullets', reason: 'The role needs both.' },
        { change: 'Moved Lakeshore to the top with three bullets', reason: 'Closest match to the core responsibilities.' },
        { change: 'Added a two-line summary', reason: 'Signals the retail analytics plus client-facing combination in a 10-second scan.' },
      ],
    };
  });

  p.on('cover_letter', (_req, prompt) => {
    const e = (re: RegExp) => ref(prompt, 'E', re);
    return {
      greeting: 'Dear Hiring Team,',
      paragraphs: [
        {
          text: "Northwind's Series B was earmarked for growing client success, which tells me the Customer Insights team is judged by whether retailers act on what it finds. That is the part of analytics I enjoy most. Last summer at Lakeshore Retail Group I presented markdown recommendations to the VP of Merchandising and two category directors, and the work only felt finished once they were discussing what to change.",
          purpose: 'hook',
          evidenceIds: [e(/Presented markdown/)],
          findingIds: ['F4'],
        },
        {
          text: 'The analysis behind it was close to the work in your posting. I analyzed 250,000+ rows of point-of-sale and inventory data in Python and SQL to find slow-moving products across 40 stores, then built Tableau dashboards that regional managers used in their weekly performance reviews.',
          purpose: 'evidence',
          evidenceIds: [e(/250,000\+ rows/), e(/Tableau dashboards used by regional/)],
          findingIds: [],
        },
        {
          text: 'I also bring the client-facing half. As a brand ambassador for Fizzwell Beverages I have worked 60+ campus and community events, and I grew event sign-ups 35% semester over semester by redesigning how people moved through our sampling booth. Talking to people who did not ask to be sold to taught me to lead with what they care about.',
          purpose: 'why_role',
          evidenceIds: [e(/60\+ campus/), e(/sign-ups 35%/)],
          findingIds: [],
        },
        {
          text: 'Your new Loyalty Insights module caught my attention because loyalty data is where promotion results become visible, and I would like to help retailers use it. I graduate in May 2026 and would welcome a conversation about the role.',
          purpose: 'close',
          evidenceIds: [ref(prompt, 'D', /Data Science/)],
          findingIds: ['F3'],
        },
      ],
      closing: 'Best regards,',
      notes: 'Opened with the client-success investment; kept company claims to cited facts.',
    };
  });

  p.on('application_answer', (_req, prompt) => {
    const question = between(prompt, '## Question\n', '\n');
    const e = (re: RegExp) => ref(prompt, 'E', re);
    if (/sponsorship/i.test(question)) {
      return {
        analysis: { testing: 'A knockout screen for work authorization.', signals: ['A clear yes/no consistent with your preferences'], pitfalls: ['Ambiguity'] },
        answer: 'No. I am authorized to work in the United States and will not require visa sponsorship now or in the future.',
        evidenceIds: [],
        findingIds: [],
        strategy: 'Answered directly from your stated work-authorization preferences.',
        needsApplicantInput: '',
      };
    }
    if (/recommendation/i.test(question)) {
      return {
        analysis: { testing: 'Whether you can turn analysis into action with stakeholders.', signals: ['A specific dataset and audience', 'What happened next'], pitfalls: ['Describing analysis with no audience'] },
        answer:
          'At Lakeshore Retail Group, regional managers suspected some products were tying up shelf space but had no consistent view across stores. I analyzed 250,000+ rows of point-of-sale and inventory data in Python and SQL and identified slow-moving products across 40 stores. Rather than hand over a spreadsheet, I built Tableau dashboards that regional managers then used in their weekly performance reviews, so the slow movers stayed visible week to week. I then presented markdown recommendations to the VP of Merchandising and two category directors. The lesson I took away is that a recommendation lands when the people deciding can see the evidence in a format they already use.',
        evidenceIds: [e(/250,000\+ rows/), e(/Tableau dashboards used by regional/), e(/Presented markdown/)],
        findingIds: [],
        strategy: 'Uses the strongest analytics story and ends on what you learned about adoption.',
        needsApplicantInput: 'If any recommendations were adopted, add what changed; it would make this answer stronger.',
      };
    }
    return {
      analysis: { testing: 'Genuine motivation and company research.', signals: ['Specific company facts', 'A link to your own experience'], pitfalls: ['Generic praise'] },
      answer:
        "Northwind sits exactly where my experience points: retail data that has to make sense to the people running stores. At Lakeshore Retail Group I built Tableau dashboards that regional managers used in weekly reviews, and I learned that adoption matters more than the model. Northwind's focus on helping mid-sized retailers plan promotions and measure loyalty, and the recent investment in client success, suggests a team that is measured on whether clients act on insights. That is the work I want to do.",
      evidenceIds: [e(/Tableau dashboards used by regional/)],
      findingIds: ['F1', 'F2', 'F4'],
      strategy: 'Grounded in cited company facts and one relevant piece of evidence.',
      needsApplicantInput: '',
    };
  });

  p.on('readiness_review', (_req, prompt) => {
    const materials = between(prompt, '<application_materials>', '</application_materials>');
    const target = 'Built Tableau dashboards that regional managers used in weekly performance reviews';
    return {
      scores: {
        resume: { score: 86, reasoning: 'Strong, specific lead role with numbers; summary positions both strengths.' },
        coverLetter: { score: 84, reasoning: 'Specific hook grounded in research; evidence-led middle; could be slightly shorter.' },
        questions: { score: 82, reasoning: 'Answers address what each question tests; the recommendation story lacks an outcome.' },
        companyAlignment: { score: 85, reasoning: 'Connects to client success investment and the loyalty product.' },
        evidence: { score: 88, reasoning: 'Nearly every claim is backed by a number or a named audience.' },
        recruiterAppeal: { score: 84, reasoning: 'Title-relevant experience is visible in the first lines.' },
      },
      strengths: ['Retail analytics experience shown with scale', 'Client-facing results that differentiate'],
      weaknesses: ['No outcome stated for the Lakeshore recommendations', 'Cover letter runs a little long'],
      recommendations: materials.includes(target)
        ? [
            {
              title: 'Tighten the dashboard bullet',
              detail: 'Lead with who used the dashboards; it reads faster in a scan.',
              severity: 'nice_to_have',
              target: 'resume',
              targetRef: '',
              find: target,
              replace: 'Built Tableau dashboards for regional managers, used in their weekly performance reviews',
            },
            { title: 'Add an outcome if you have one', detail: 'If any markdown recommendations were adopted, add it in Career Brain and regenerate.', severity: 'important', target: 'general', targetRef: '', find: '', replace: '' },
          ]
        : [],
      verdict: 'almost_ready',
      verdictReason: 'Strong application; approve the documents after a final read.',
    };
  });
}
