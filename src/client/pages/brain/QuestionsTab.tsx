import { useEffect, useState } from 'react';
import { LuMessageSquare, LuRefreshCw, LuSparkles } from 'react-icons/lu';
import { api } from '../../lib/api';
import { useQuery } from '../../lib/query';
import { useAction } from '../../lib/actions';
import { relativeTime } from '../../lib/format';
import type { QuestionDTO, TaskDTO } from '../../lib/types';
import { Button, EmptyState, Input, Skeleton, Textarea, ToggleGroup } from '../../components/ui/primitives';
import { cn } from '../../components/ui/cn';

const CATEGORY_LABEL: Record<string, string> = {
  achievement: 'Results',
  metric: 'Measurable impact',
  responsibility: 'Scope of the role',
  customer: 'Customer-facing work',
  stakeholder: 'Working with stakeholders',
  sales: 'Sales',
  leadership: 'Leadership',
  technical: 'Technical depth',
  project: 'Project outcome',
  presentation: 'Presenting',
  challenge: 'Problem solving',
  goals: 'Career goals',
  conflict: 'Your documents disagree',
};

function AnswerInput({ q, value, onChange }: { q: QuestionDTO; value: string; onChange: (v: string) => void }) {
  if (q.answerType === 'yes_no') {
    return (
      <ToggleGroup
        options={[
          { value: 'Yes', label: 'Yes' },
          { value: 'No', label: 'No' },
        ]}
        value={value || null}
        onChange={(v: string | null) => onChange(v ?? '')}
      />
    );
  }
  if (q.answerType === 'choice' && q.choices.length) {
    return <ToggleGroup options={q.choices.map((c) => ({ value: c, label: c }))} value={value || null} onChange={(v: string | null) => onChange(v ?? '')} />;
  }
  if (q.answerType === 'number') {
    return <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="A number, or a short sentence with the number" className="max-w-md" autoFocus />;
  }
  const placeholder = q.category === 'conflict' ? 'Pick one above, or write the correct detail.' : 'A sentence or two is enough. Include numbers if you know them.';
  return (
    <div className="flex flex-col gap-3">
      {q.choices.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {q.choices.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onChange(c)}
              className={cn(
                'rounded-control border px-3 py-1.5 text-sm',
                value === c ? 'border-ink bg-ink text-white' : 'border-rule-strong bg-surface text-ink hover:border-ink/40',
              )}
            >
              {c}
            </button>
          ))}
        </div>
      )}
      <Textarea value={value} onChange={(e) => onChange(e.target.value)} rows={q.choices.length ? 2 : 4} placeholder={placeholder} autoFocus={!q.choices.length} />
    </div>
  );
}

export function QuestionsTab() {
  const { data, loading } = useQuery<{ open: QuestionDTO[]; answered: QuestionDTO[]; tasks: TaskDTO[] }>('/api/brain/questions');
  const { run, busy } = useAction();
  const [focusId, setFocusId] = useState<string | null>(null);
  const [answer, setAnswer] = useState('');
  const open = data?.open ?? [];
  const focus = open.find((q) => q.id === focusId) ?? open[0];
  useEffect(() => setAnswer(''), [focus?.id]);
  if (loading || !data) return <Skeleton className="h-56 w-full" />;
  const refresh = ['/api/brain'];
  const working = data.tasks.length > 0;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0">
        {focus ? (
          <section className="rounded-panel border border-rule bg-surface px-6 py-6">
            <div className="flex items-center justify-between gap-3 text-[12.5px]">
              <span className={cn('font-medium', focus.category === 'conflict' ? 'text-ochre' : 'text-jade-strong')}>{CATEGORY_LABEL[focus.category] ?? 'Background'}</span>
              <span className="text-mist tabular">
                {open.indexOf(focus) + 1} of {open.length}
              </span>
            </div>
            <h2 className="mt-3 font-display text-[22px] leading-snug font-semibold text-ink">{focus.question}</h2>
            {focus.rationale && <p className="mt-2 text-sm leading-relaxed text-graphite">{focus.rationale}</p>}
            <div className="mt-5">
              <AnswerInput q={focus} value={answer} onChange={setAnswer} />
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                disabled={!answer.trim()}
                loading={busy === 'answer'}
                onClick={async () => {
                  const r = await run('answer', () => api.post(`/api/brain/questions/${focus.id}/answer`, { answer }), { refresh: [...refresh, '/api/brain/questions'], success: 'Saved. Updating your Career Brain…' });
                  if (r) {
                    setAnswer('');
                    setFocusId(null);
                  }
                }}
              >
                Save answer
              </Button>
              <Button
                variant="ghost"
                loading={busy === 'skip'}
                onClick={async () => {
                  await run('skip', () => api.post(`/api/brain/questions/${focus.id}/skip`), { refresh: ['/api/brain/questions', '/api/brain'] });
                  setFocusId(null);
                }}
              >
                Skip
              </Button>
              <span className="ml-auto text-[12px] text-mist">Your answer is stored as "provided by you" and can be used in applications.</span>
            </div>
          </section>
        ) : (
          <div className="rounded-panel border border-rule bg-surface">
            <EmptyState
              icon={<LuMessageSquare />}
              title={working ? 'Updating your Career Brain…' : 'No open questions'}
              action={
                <Button icon={<LuSparkles className="size-4" />} loading={busy === 'refresh'} disabled={working} onClick={() => void run('refresh', () => api.post('/api/brain/questions/refresh'), { refresh: ['/api/brain/questions', '/api/brain'] })}>
                  Suggest new questions
                </Button>
              }
            >
              Questions appear when something would make your applications stronger: a missing number, an outcome, or a detail your documents disagree on.
            </EmptyState>
          </div>
        )}

        {data.answered.length > 0 && (
          <section className="mt-8">
            <h3 className="mb-3 text-[15px] font-semibold text-ink">Answered</h3>
            <ul className="flex flex-col divide-y divide-rule rounded-panel border border-rule bg-surface">
              {data.answered.map((q) => (
                <li key={q.id} className="px-5 py-3.5">
                  <div className="text-[13px] text-graphite">{q.question}</div>
                  <div className="mt-1 text-sm text-ink">{q.answer}</div>
                  <div className="mt-1 text-[12px] text-mist">{relativeTime(q.answeredAt)}</div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <aside>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-[13px] font-medium text-ink">Up next</h3>
          {open.length > 0 && (
            <button
              type="button"
              disabled={working}
              onClick={() => void run('refresh', () => api.post('/api/brain/questions/refresh'), { refresh: ['/api/brain/questions', '/api/brain'] })}
              className="inline-flex items-center gap-1 text-[12px] text-graphite hover:text-ink disabled:opacity-50"
            >
              <LuRefreshCw className="size-3" /> New set
            </button>
          )}
        </div>
        <ol className="flex flex-col gap-1">
          {open.map((q) => (
            <li key={q.id}>
              <button
                type="button"
                onClick={() => setFocusId(q.id)}
                className={cn('w-full rounded-control px-3 py-2 text-left text-[13px] leading-snug', q.id === focus?.id ? 'bg-ink/[0.06] text-ink' : 'text-graphite hover:bg-ink/[0.03] hover:text-ink')}
              >
                {q.category === 'conflict' && <span className="mr-1.5 inline-block size-1.5 rounded-full bg-ochre align-middle" />}
                {q.question}
              </button>
            </li>
          ))}
          {!open.length && <li className="px-3 text-[13px] text-mist">Nothing waiting.</li>}
        </ol>
      </aside>
    </div>
  );
}
