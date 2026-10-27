/**
 * A fictional applicant used by tests and the demo walkthrough. Two resumes describe the same
 * person differently (one analytics-focused DOCX, one client-facing PDF), with one genuine
 * conflict (Campus Rec end date) for the consolidation step to catch.
 */
import { Document, Packer, Paragraph, TextRun } from 'docx';
import { PDFDocument, StandardFonts } from 'pdf-lib';

export const RESUME_A_LINES = [
  'Jordan Rivera',
  'Chicago, IL | (312) 555-0187 | jordan.rivera@example.com | linkedin.com/in/jordanrivera-example',
  '',
  'EDUCATION',
  'University of Illinois Chicago — B.S. in Data Science, minor in Business Administration',
  'Chicago, IL | Aug 2022 – May 2026 | GPA 3.6/4.0',
  'Relevant coursework: Statistical Learning, Database Systems, Data Visualization, Consumer Behavior',
  '',
  'EXPERIENCE',
  'Lakeshore Retail Group — Data Analytics Intern',
  'Chicago, IL | Jun 2025 – Aug 2025',
  '• Analyzed 250,000+ rows of point-of-sale and inventory data in Python and SQL to identify slow-moving products across 40 stores',
  '• Built Tableau dashboards used by regional managers in weekly performance reviews',
  '• Presented markdown recommendations to the VP of Merchandising and two category directors',
  '',
  'Campus Rec Center — Student Supervisor',
  'Chicago, IL | Sep 2023 – May 2025',
  '• Supervised a team of 8 student staff across evening shifts',
  '• Resolved member issues and handled 30+ front-desk inquiries per shift',
  '',
  'PROJECTS',
  'Customer Churn Analysis (Capstone) — Python, scikit-learn',
  '• Built a churn model on 12 months of subscription data for a local gym chain and presented findings to the owner',
  '',
  'SKILLS',
  'Python, SQL, Tableau, Excel, scikit-learn, Data visualization, Stakeholder presentations',
];

export const RESUME_B_LINES = [
  'JORDAN RIVERA',
  'Chicago, IL | jordan.rivera@example.com | (312) 555-0187',
  '',
  'PROFILE',
  'Data science student with sales, events and client experience.',
  '',
  'EXPERIENCE',
  'Brand Ambassador, Fizzwell Beverages — Chicago, IL (Jan 2023 – Present)',
  '• Represented the brand at 60+ campus and community events',
  '• Grew event sign-ups 35% semester over semester by redesigning the sampling booth flow',
  '• Trained 5 new ambassadors on product messaging',
  '',
  'Data Analytics Intern, Lakeshore Retail — Chicago, IL (Summer 2025)',
  '• Built Tableau dashboards for regional managers',
  '• Analyzed 250k rows of sales data to flag slow-moving stock',
  '',
  'Student Supervisor, Campus Rec Center — Chicago, IL (2023 – 2024)',
  '• Led evening shifts and handled member questions',
  '',
  'Captain, UIC Club Soccer — Chicago, IL (2023 – 2026)',
  '• Led a 24-player club team and organized travel for 6 away tournaments',
  '',
  'EDUCATION',
  'University of Illinois Chicago, B.S. Data Science (expected May 2026)',
  '',
  'SKILLS',
  'Client relationships, Event marketing, Public speaking, Python, SQL, Tableau, HubSpot',
];

export async function resumeADocx(): Promise<Buffer> {
  const doc = new Document({
    sections: [
      {
        children: RESUME_A_LINES.map((line) =>
          line.startsWith('• ')
            ? new Paragraph({ bullet: { level: 0 }, children: [new TextRun(line.slice(2))] })
            : new Paragraph({ children: [new TextRun({ text: line, bold: /^[A-Z ]+$/.test(line) && line.length > 3 })] }),
        ),
      },
    ],
  });
  return Packer.toBuffer(doc);
}

export async function resumeBPdf(): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  let y = 740;
  for (const line of RESUME_B_LINES) {
    if (line) page.drawText(line, { x: 50, y, size: 10, font });
    y -= 15;
  }
  return Buffer.from(await pdf.save());
}

export const JOB_POSTING = `Customer Insights Analyst
Northwind Analytics — Chicago, IL (Hybrid, 3 days in office)

About Northwind
Northwind Analytics builds retail analytics software that helps mid-sized grocery and specialty retailers understand shopper behavior. Our customers use Northwind to plan promotions, manage inventory and measure loyalty programs.

The role
As a Customer Insights Analyst on our Client Success team, you will turn client data into clear recommendations, build dashboards that client stakeholders use every week, and present findings to retail category managers. You will partner with account managers on renewals and help clients get value from Northwind.

What you'll do
- Analyze point-of-sale, loyalty and inventory data to answer client questions
- Build and maintain Tableau or Power BI dashboards for client stakeholders
- Present insights and recommendations to non-technical audiences
- Work with account managers to prepare quarterly business reviews
- Document analyses and share best practices with the team

What you'll bring
- Bachelor's degree in a quantitative field (data science, statistics, economics, or similar)
- Proficiency in SQL and Python for data analysis
- Experience with Tableau or Power BI
- Strong communication skills and comfort presenting to stakeholders
- 0-2 years of experience in analytics, consulting or a client-facing role

Nice to have
- Retail or consumer goods experience
- Experience in a client-facing or sales role
- Familiarity with Salesforce or another CRM

Compensation: $68,000 – $80,000 per year plus annual bonus.
Northwind is unable to sponsor employment visas for this position.`;

export const JOB_QUESTIONS = `1. Why are you interested in Northwind Analytics? (150 words max)
2. Describe a time you turned data into a recommendation that someone acted on. (250 words max)
3. Will you now or in the future require visa sponsorship?`;
