import { z, type ZodType } from 'zod/v4';
import { AiOutputError } from './errors';

const STRIP_KEYS = new Set([
  '$schema',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'pattern',
  'format',
  'minItems',
  'maxItems',
  'default',
  'uniqueItems',
]);

/**
 * Convert a zod schema to the conservative JSON Schema subset accepted by provider-native
 * structured outputs: unsupported constraints are removed (they are still enforced by zod
 * after the response), every object is closed and lists all properties as required.
 */
export function toProviderJsonSchema(schema: ZodType): Record<string, unknown> {
  const raw = z.toJSONSchema(schema, { target: 'draft-2020-12', unrepresentable: 'any' }) as Record<string, unknown>;
  return sanitize(raw) as Record<string, unknown>;
}

function sanitize(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sanitize);
  if (!node || typeof node !== 'object') return node;
  const src = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const notes: string[] = [];
  for (const [k, v] of Object.entries(src)) {
    if (STRIP_KEYS.has(k)) {
      if (k === 'minimum' || k === 'maximum') notes.push(`${k} ${v}`);
      continue;
    }
    out[k] = sanitize(v);
  }
  if (out.type === 'object' && out.properties && typeof out.properties === 'object') {
    out.additionalProperties = false;
    out.required = Object.keys(out.properties as object);
  }
  if (notes.length) {
    out.description = [out.description, `(${notes.join(', ')})`].filter(Boolean).join(' ');
  }
  return out;
}

/** Extract a JSON value from model text (handles code fences and leading prose). */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    /* fall through */
  }
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try {
      return JSON.parse(fence[1]);
    } catch {
      /* fall through */
    }
  }
  const start = trimmed.search(/[{[]/);
  if (start >= 0) {
    const open = trimmed[start];
    const close = open === '{' ? '}' : ']';
    const end = trimmed.lastIndexOf(close);
    if (end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        /* fall through */
      }
    }
  }
  throw new AiOutputError('Response was not valid JSON.', text.slice(0, 2000));
}

export function validateOutput<T>(schema: ZodType<T>, value: unknown): { ok: true; data: T } | { ok: false; error: string } {
  const result = schema.safeParse(value);
  if (result.success) return { ok: true, data: result.data };
  const issues = result.error.issues.slice(0, 12).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
  return { ok: false, error: issues.join('; ') };
}
