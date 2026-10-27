import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { invalidate } from './query';
import type { TaskDTO } from './types';

/**
 * Poll background tasks until they finish, then refresh the given query prefixes.
 * Pass the tasks currently known as active (from the page payload).
 */
export function useTaskWatcher(tasks: TaskDTO[] | undefined, refreshPrefixes: string[], onFinish?: (t: TaskDTO) => void) {
  const [live, setLive] = useState<Record<string, TaskDTO>>({});
  const prefixesRef = useRef(refreshPrefixes);
  prefixesRef.current = refreshPrefixes;
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;
  const ids = (tasks ?? []).filter((t) => t.status === 'queued' || t.status === 'running').map((t) => t.id);
  const key = ids.join(',');

  useEffect(() => {
    if (!key) return;
    let stopped = false;
    const watch = key.split(',');
    const tick = async () => {
      for (const id of watch) {
        try {
          const t = await api.get<TaskDTO>(`/api/tasks/${id}`);
          if (stopped) return;
          setLive((prev) => ({ ...prev, [id]: t }));
          if (['succeeded', 'failed', 'canceled'].includes(t.status)) {
            onFinishRef.current?.(t);
            prefixesRef.current.forEach((p) => invalidate(p));
          }
        } catch {
          /* transient */
        }
      }
    };
    void tick();
    const timer = setInterval(tick, 1200);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [key]);

  return (tasks ?? []).map((t) => live[t.id] ?? t).filter((t) => t.status === 'queued' || t.status === 'running');
}
