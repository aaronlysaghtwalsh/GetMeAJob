export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: { fieldErrors?: Record<string, string[]>; formErrors?: string[] } | unknown,
  ) {
    super(message);
  }

  fieldError(name: string): string | undefined {
    const d = this.details as { fieldErrors?: Record<string, string[]> } | undefined;
    return d?.fieldErrors?.[name]?.[0];
  }
}

type Listener = (err: ApiError) => void;
const unauthorizedListeners = new Set<Listener>();
export function onUnauthorized(fn: Listener): () => void {
  unauthorizedListeners.add(fn);
  return () => unauthorizedListeners.delete(fn);
}

async function request<T>(method: string, path: string, body?: unknown, isForm = false): Promise<T> {
  const headers: Record<string, string> = { 'x-gmaj-csrf': '1' };
  let payload: BodyInit | undefined;
  if (body !== undefined) {
    if (isForm) payload = body as FormData;
    else {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
  }
  let resp: Response;
  try {
    resp = await fetch(path, { method, headers, body: payload, credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'network', 'Cannot reach the GetMeAJob server. Check that it is running.');
  }
  if (resp.status === 204) return undefined as T;
  const text = await resp.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!resp.ok) {
    const err = new ApiError(resp.status, data?.error?.code ?? 'error', data?.error?.message ?? `Request failed (${resp.status}).`, data?.error?.details);
    if (resp.status === 401 && !path.startsWith('/api/auth/')) unauthorizedListeners.forEach((l) => l(err));
    throw err;
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown = {}) => request<T>('POST', path, body),
  put: <T>(path: string, body: unknown = {}) => request<T>('PUT', path, body),
  patch: <T>(path: string, body: unknown = {}) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
  upload: <T>(path: string, form: FormData) => request<T>('POST', path, form, true),
};
