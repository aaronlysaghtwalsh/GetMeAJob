import { useCallback, useState } from 'react';
import { ApiError } from './api';
import { invalidate } from './query';
import { useToast } from '../components/ui/overlays';

/**
 * Wrap a mutation: tracks busy state, shows errors as toasts, refreshes cached queries on success.
 */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback(
    async <T,>(key: string, fn: () => Promise<T>, opts: { refresh?: string[]; success?: string } = {}): Promise<T | undefined> => {
      setBusy(key);
      try {
        const result = await fn();
        for (const p of opts.refresh ?? []) invalidate(p);
        if (opts.success) toast(opts.success, 'success');
        return result;
      } catch (err) {
        toast(err instanceof ApiError ? err.message : 'Something went wrong.', 'error');
        return undefined;
      } finally {
        setBusy(null);
      }
    },
    [toast],
  );
  return { run, busy };
}
