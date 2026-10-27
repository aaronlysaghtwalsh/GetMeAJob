import { z, ZodError, type ZodType } from 'zod/v4';
import type { App } from '../app';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  plan: string;
}

export interface Ctx {
  app: App;
  req: Request;
  url: URL;
  params: Record<string, string>;
  ip: string;
  cookies: Record<string, string>;
  user: AuthUser | null;
  sessionId: string | null;
  /** Headers added to whatever response the handler returns (e.g. Set-Cookie). */
  extraHeaders: Headers;
}

export type Handler = (ctx: Ctx) => Promise<Response> | Response;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, 'bad_request', message, details);
export const unauthorized = (message = 'Sign in to continue.') => new HttpError(401, 'unauthorized', message);
export const forbidden = (message = 'You do not have access to this.') => new HttpError(403, 'forbidden', message);
export const notFound = (message = 'Not found.') => new HttpError(404, 'not_found', message);
export const conflict = (message: string, details?: unknown) => new HttpError(409, 'conflict', message, details);
export const tooMany = (message = 'Too many attempts. Wait a minute and try again.') => new HttpError(429, 'rate_limited', message);

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function noContent(): Response {
  return new Response(null, { status: 204 });
}

export function requireUser(ctx: Ctx): AuthUser {
  if (!ctx.user) throw unauthorized();
  return ctx.user;
}

const JSON_LIMIT = 2 * 1024 * 1024;

export async function readText(ctx: Ctx, limit = JSON_LIMIT): Promise<string> {
  const len = Number(ctx.req.headers.get('content-length') || 0);
  if (len > limit) throw new HttpError(413, 'too_large', 'Request body is too large.');
  const text = await ctx.req.text();
  if (Buffer.byteLength(text) > limit) throw new HttpError(413, 'too_large', 'Request body is too large.');
  return text;
}

/** Parse and validate a JSON body against a zod schema. */
export async function readJson<T>(ctx: Ctx, schema: ZodType<T>, limit = JSON_LIMIT): Promise<T> {
  const text = await readText(ctx, limit);
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw badRequest('Body must be valid JSON.');
  }
  return parseWith(schema, data);
}

export function parseWith<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw badRequest('Some fields are invalid.', z.flattenError(result.error as ZodError));
  }
  return result.data;
}

export function queryParam(ctx: Ctx, name: string): string | undefined {
  return ctx.url.searchParams.get(name) ?? undefined;
}
