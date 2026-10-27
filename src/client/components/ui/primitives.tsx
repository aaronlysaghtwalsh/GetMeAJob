import { createContext, forwardRef, useCallback, useContext, useId, useLayoutEffect, useMemo, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from './cn';

/* Button ---------------------------------------------------------------------------------------- */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent' | 'link';
type ButtonSize = 'sm' | 'md' | 'lg';

const buttonBase =
  'inline-flex items-center justify-center gap-2 font-medium whitespace-nowrap transition-colors disabled:opacity-50 disabled:cursor-not-allowed select-none';
const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'bg-ink text-white hover:bg-ink-soft active:bg-ink shadow-[0_1px_0_rgba(24,33,47,0.12)]',
  secondary: 'bg-surface text-ink border border-rule-strong hover:bg-paper hover:border-mist',
  ghost: 'text-graphite hover:text-ink hover:bg-ink/5',
  danger: 'bg-brick text-white hover:bg-brick/90',
  accent: 'bg-jade text-white hover:bg-jade-strong',
  link: 'text-cobalt hover:underline underline-offset-2 px-0 h-auto',
};
const buttonSizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px] rounded-control',
  md: 'h-9 px-3.5 text-sm rounded-control',
  lg: 'h-11 px-5 text-[15px] rounded-control',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(buttonBase, buttonVariants[variant], variant !== 'link' && buttonSizes[size], className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner className="size-4" /> : icon}
      {children}
    </button>
  );
});

/* Spinner --------------------------------------------------------------------------------------- */

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn('animate-spin text-current', className ?? 'size-4')} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/* Form controls --------------------------------------------------------------------------------- */

const controlBase =
  'w-full rounded-control border border-rule-strong bg-surface px-3 text-sm text-ink placeholder:text-mist transition-colors hover:border-mist focus:border-cobalt focus:outline-none focus:ring-2 focus:ring-cobalt/15 disabled:bg-paper disabled:text-graphite aria-[invalid=true]:border-brick';

/**
 * Field wiring: a Field offers its label to the first Input/Textarea/Select inside it. If no such control
 * claims the label (toggle groups, tag inputs), the Field becomes a named group instead, so every control
 * has an accessible name without each call site passing ids around.
 */
interface FieldContextValue {
  id: string;
  describedBy?: string;
  invalid: boolean;
  claim: () => void;
}
const FieldContext = createContext<FieldContextValue | null>(null);

function useFieldControl(explicitId: string | undefined) {
  const ctx = useContext(FieldContext);
  const claim = ctx?.claim;
  const own = !!ctx && !explicitId;
  useLayoutEffect(() => {
    if (own && claim) claim();
  }, [own, claim]);
  if (!ctx || explicitId) return {};
  return { id: ctx.id, 'aria-describedby': ctx.describedBy, ...(ctx.invalid ? { 'aria-invalid': true } : {}) };
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  const field = useFieldControl(rest.id);
  return <input ref={ref} className={cn(controlBase, 'h-9', className)} {...field} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  const field = useFieldControl(rest.id);
  return <textarea ref={ref} className={cn(controlBase, 'min-h-24 py-2 leading-relaxed', className)} {...field} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  const field = useFieldControl(rest.id);
  return (
    <select ref={ref} className={cn(controlBase, 'h-9 pr-8 appearance-none bg-[length:16px] bg-[right_8px_center] bg-no-repeat select-chevron', className)} {...field} {...rest}>
      {children}
    </select>
  );
});

export function Field({
  label,
  hint,
  error,
  children,
  className,
  htmlFor,
  optional,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
  className?: string;
  htmlFor?: string;
  optional?: boolean;
}) {
  const autoId = useId();
  const id = htmlFor ?? `${autoId}control`;
  const labelId = `${autoId}label`;
  const noteId = `${autoId}note`;
  const [claimed, setClaimed] = useState(!!htmlFor);
  const claim = useCallback(() => setClaimed(true), []);
  const ctx = useMemo<FieldContextValue>(() => ({ id, describedBy: error || hint ? noteId : undefined, invalid: !!error, claim }), [id, error, hint, noteId, claim]);
  return (
    <FieldContext.Provider value={ctx}>
      <div className={cn('flex flex-col gap-1.5', className)} {...(claimed ? {} : { role: 'group', 'aria-labelledby': labelId })}>
        <label id={labelId} htmlFor={claimed ? id : undefined} className="text-[13px] font-medium text-ink">
          {label}
          {optional && <span className="ml-1.5 font-normal text-mist">optional</span>}
        </label>
        {children}
        {error ? (
          <p id={noteId} className="text-[13px] text-brick">
            {error}
          </p>
        ) : hint ? (
          <p id={noteId} className="text-[13px] text-graphite">
            {hint}
          </p>
        ) : null}
      </div>
    </FieldContext.Provider>
  );
}

export function Checkbox({ label, checked, onChange, description, disabled }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; description?: ReactNode; disabled?: boolean }) {
  const id = useId();
  return (
    <label htmlFor={id} className={cn('flex items-start gap-2.5 text-sm', disabled ? 'opacity-60' : 'cursor-pointer')}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-4 shrink-0 rounded border-rule-strong accent-ink"
      />
      <span>
        <span className="text-ink">{label}</span>
        {description && <span className="block text-[13px] text-graphite">{description}</span>}
      </span>
    </label>
  );
}

/** A row of mutually exclusive or multi-select pill toggles. */
export function ToggleGroup<T extends string>({
  options,
  value,
  onChange,
  multiple,
  size = 'md',
}: {
  options: { value: T; label: string }[];
  value: T[] | T | null;
  onChange: (v: any) => void;
  multiple?: boolean;
  size?: 'sm' | 'md';
}) {
  const selected = new Set(Array.isArray(value) ? value : value ? [value] : []);
  return (
    <div className="flex flex-wrap gap-1.5" role={multiple ? 'group' : 'radiogroup'}>
      {options.map((o) => {
        const on = selected.has(o.value);
        return (
          <button
            key={o.value}
            type="button"
            role={multiple ? 'checkbox' : 'radio'}
            aria-checked={on}
            onClick={() => {
              if (multiple) {
                const next = new Set(selected);
                if (on) next.delete(o.value);
                else next.add(o.value);
                onChange(options.map((x) => x.value).filter((v) => next.has(v)));
              } else onChange(on ? null : o.value);
            }}
            className={cn(
              'rounded-full border transition-colors',
              size === 'sm' ? 'px-2.5 py-0.5 text-[12px]' : 'px-3 py-1 text-[13px]',
              on ? 'border-ink bg-ink text-white' : 'border-rule-strong bg-surface text-ink-soft hover:border-mist',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* Badge ------------------------------------------------------------------------------------------ */

export type Tone = 'neutral' | 'jade' | 'cobalt' | 'ochre' | 'brick' | 'ink';
const tones: Record<Tone, string> = {
  neutral: 'bg-ink/[0.06] text-ink-soft',
  jade: 'bg-jade-tint text-jade-strong',
  cobalt: 'bg-cobalt-tint text-cobalt',
  ochre: 'bg-ochre-tint text-ochre',
  brick: 'bg-brick-tint text-brick',
  ink: 'bg-ink text-white',
};

export function Badge({ tone = 'neutral', children, className, title }: { tone?: Tone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium whitespace-nowrap', tones[tone], className)}>
      {children}
    </span>
  );
}

/* Layout helpers --------------------------------------------------------------------------------- */

export function Panel({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
  id,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cn('rounded-panel border border-rule bg-surface', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-rule px-5 py-3.5">
          <div className="min-w-0">
            {title && <h2 className="text-[15px] font-semibold text-ink">{title}</h2>}
            {description && <p className="mt-0.5 text-[13px] text-graphite">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn('px-5 py-4', bodyClassName)}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, description, actions, eyebrow }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0 max-w-3xl">
        {eyebrow && <div className="mb-1.5 text-[13px] text-graphite">{eyebrow}</div>}
        <h1 className="font-display text-[28px] leading-tight font-semibold tracking-[-0.01em] text-ink">{title}</h1>
        {description && <p className="mt-1.5 text-[15px] leading-relaxed text-graphite">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      {icon && <div className="mb-3 text-mist [&>svg]:size-8">{icon}</div>}
      <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
      {children && <div className="mt-1 max-w-md text-sm leading-relaxed text-graphite">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Callout({ tone = 'neutral', title, children, icon, action, className }: { tone?: Tone; title?: ReactNode; children?: ReactNode; icon?: ReactNode; action?: ReactNode; className?: string }) {
  const toneClass: Record<Tone, string> = {
    neutral: 'border-rule bg-paper',
    jade: 'border-jade/25 bg-jade-tint/60',
    cobalt: 'border-cobalt/20 bg-cobalt-tint/70',
    ochre: 'border-ochre/25 bg-ochre-tint/70',
    brick: 'border-brick/25 bg-brick-tint/70',
    ink: 'border-ink bg-ink text-white',
  };
  return (
    <div className={cn('flex gap-3 rounded-panel border px-4 py-3 text-sm', toneClass[tone], className)}>
      {icon && <div className="mt-0.5 shrink-0 [&>svg]:size-4">{icon}</div>}
      <div className="min-w-0 flex-1">
        {title && <div className="font-medium text-ink">{title}</div>}
        {children && <div className={cn('leading-relaxed', title ? 'mt-0.5 text-ink-soft' : 'text-ink-soft')}>{children}</div>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded bg-ink/[0.06]', className)} />;
}

export function Divider({ className }: { className?: string }) {
  return <hr className={cn('border-rule', className)} />;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-rule-strong bg-paper px-1.5 text-[12px] text-graphite">{children}</kbd>;
}
