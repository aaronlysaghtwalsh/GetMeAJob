// Type-only re-exports of server and shared DTOs used by the client (erased at build time).
export type {
  CareerBrainDTO,
  DocumentDTO,
  EvidenceDTO,
  EvidenceSource,
  ExperienceDTO,
  EducationDTO,
  ProjectDTO,
  SkillDTO,
  ProfileDTO,
  QuestionDTO,
  Preferences,
  ResumeSourceDTO,
} from '../../shared/schemas/brain';
export type { JobIntelligence } from '../../shared/schemas/job';
export type { ResearchContent, ResearchSource } from '../../shared/schemas/research';
export type { FitContent, FitGuardrail } from '../../shared/schemas/fit';
export type { Strategy } from '../../shared/schemas/strategy';
export type {
  ResumeContent,
  ResumeDraft,
  ResumeDoc,
  ResumeItem,
  CoverLetterContent,
  AnswerContent,
  ReviewContent,
  IntegrityIssue,
  IntegrityReport,
  WritingLint,
  AtsReport,
} from '../../shared/schemas/documents';
export type { ApplicationDTO, ArtifactDTO, JobDTO, ContactDTO, NoteDTO, EventDTO, QuestionRowDTO } from '../../server/repos/applications';
export type { TaskDTO, TaskProgress } from '../../server/tasks/queue';
export type { Readiness, ReadinessItem } from '../../server/services/brain/readiness';
export type { AiStatus } from '../../server/ai/service';

import type { ApplicationDTO, ArtifactDTO, JobDTO, ContactDTO, NoteDTO, EventDTO, QuestionRowDTO } from '../../server/repos/applications';
import type { TaskDTO } from '../../server/tasks/queue';
import type { AiStatus } from '../../server/ai/service';
import type { ResearchContent } from '../../shared/schemas/research';
import type { FitContent } from '../../shared/schemas/fit';
import type { Strategy } from '../../shared/schemas/strategy';
import type { AnswerContent, CoverLetterContent, ResumeContent, ReviewContent } from '../../shared/schemas/documents';

export interface VersionMeta {
  id: string;
  version: number;
  status: ArtifactDTO['status'];
  createdAt: string;
  approvedAt: string | null;
  changeSummary: string;
  createdBy: 'ai' | 'user';
}

export interface WorkspaceData {
  application: ApplicationDTO;
  job: JobDTO;
  artifacts: {
    research: ArtifactDTO<ResearchContent> | null;
    fit: ArtifactDTO<FitContent> | null;
    strategy: ArtifactDTO<Strategy> | null;
    resume: ArtifactDTO<ResumeContent> | null;
    cover_letter: ArtifactDTO<CoverLetterContent> | null;
    review: ArtifactDTO<ReviewContent> | null;
  };
  versions: Record<'research' | 'fit' | 'strategy' | 'resume' | 'cover_letter' | 'review', VersionMeta[]>;
  questions: (QuestionRowDTO & { answer: ArtifactDTO<AnswerContent> | null; versions: VersionMeta[] })[];
  contacts: ContactDTO[];
  notes: NoteDTO[];
  events: EventDTO[];
  tasks: TaskDTO[];
  lastTask: TaskDTO | null;
  ai: AiStatus;
}

export interface ApplicationListItem extends ApplicationDTO {
  job: { title: string; companyName: string; location: string; workModel: string; salaryText: string; sourceUrl: string };
  fit: { overall: number; tier: string; headline: string; effortMinutes: number } | null;
  readiness: { overall: number; verdict: string } | null;
  running: boolean;
}
