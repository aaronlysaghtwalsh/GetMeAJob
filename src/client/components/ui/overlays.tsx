import {
  Dialog as HDialog,
  DialogBackdrop,
  DialogPanel,
  DialogTitle,
  Menu as HMenu,
  MenuButton,
  MenuItem,
  MenuItems,
} from '@headlessui/react';
import {
  autoUpdate,
  flip,
  FloatingPortal,
  offset,
  safePolygon,
  shift,
  useDismiss,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
  useRole,
  type Placement,
} from '@floating-ui/react';
import { createContext, useCallback, useContext, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { LuX } from 'react-icons/lu';
import { cn } from './cn';
import { Link } from '../../lib/router';

/* Dialog ------------------------------------------------------------------------------------------ */

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  const width = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' }[size];
  return (
    <HDialog open={open} onClose={onClose} className="relative z-50">
      <DialogBackdrop className="fixed inset-0 bg-ink/30 backdrop-blur-[1px]" />
      <div className="fixed inset-0 flex items-start justify-center overflow-y-auto p-4 sm:items-center sm:p-8">
        <DialogPanel className={cn('w-full rounded-panel border border-rule bg-surface shadow-[0_24px_60px_-20px_rgba(24,33,47,0.35)]', width)}>
          <div className="flex items-start justify-between gap-4 border-b border-rule px-5 py-4">
            <div className="min-w-0">
              <DialogTitle className="text-base font-semibold text-ink">{title}</DialogTitle>
              {description && <p className="mt-1 text-sm text-graphite">{description}</p>}
            </div>
            <button type="button" onClick={onClose} className="-mr-1 rounded p-1 text-graphite hover:bg-ink/5 hover:text-ink" aria-label="Close">
              <LuX className="size-4" />
            </button>
          </div>
          {children && <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>}
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-rule bg-paper/60 px-5 py-3">{footer}</div>}
        </DialogPanel>
      </div>
    </HDialog>
  );
}

/* Menu -------------------------------------------------------------------------------------------- */

export interface MenuAction {
  label: string;
  onSelect?: () => void;
  href?: string;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
}

export function Menu({ button, items, align = 'end' }: { button: ReactNode; items: (MenuAction | 'divider')[]; align?: 'start' | 'end' }) {
  return (
    <HMenu>
      <MenuButton as="div" className="inline-flex">
        {button}
      </MenuButton>
      <MenuItems
        anchor={align === 'end' ? 'bottom end' : 'bottom start'}
        className="z-50 mt-1 min-w-48 rounded-control border border-rule bg-surface p-1 shadow-[0_12px_32px_-12px_rgba(24,33,47,0.3)] focus:outline-none"
      >
        {items.map((item, i) =>
          item === 'divider' ? (
            <div key={`d${i}`} className="my-1 border-t border-rule" />
          ) : (
            <MenuItem key={item.label} disabled={item.disabled}>
              {item.href ? (
                <Link
                  to={item.href}
                  className={cn(
                    'flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-sm data-[focus]:bg-ink/5',
                    item.danger ? 'text-brick' : 'text-ink',
                    '[&>svg]:size-4 [&>svg]:text-graphite',
                  )}
                >
                  {item.icon}
                  {item.label}
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={item.onSelect}
                  className={cn(
                    'flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-sm data-[disabled]:opacity-50 data-[focus]:bg-ink/5',
                    item.danger ? 'text-brick [&>svg]:text-brick' : 'text-ink [&>svg]:text-graphite',
                    '[&>svg]:size-4',
                  )}
                >
                  {item.icon}
                  {item.label}
                </button>
              )}
            </MenuItem>
          ),
        )}
      </MenuItems>
    </HMenu>
  );
}

/* Tooltip / hover card ------------------------------------------------------------------------------- */

export function HoverCard({
  trigger,
  children,
  placement = 'top',
  className,
  interactive = true,
}: {
  trigger: ReactNode;
  children: ReactNode;
  placement?: Placement;
  className?: string;
  interactive?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement,
    middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });
  const hover = useHover(context, { delay: { open: 120, close: 80 }, handleClose: interactive ? safePolygon() : undefined });
  const focus = useFocus(context);
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: 'tooltip' });
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, dismiss, role]);
  return (
    <>
      <span ref={refs.setReference} {...getReferenceProps()} className="inline">
        {trigger}
      </span>
      {open && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className={cn(
              'z-50 max-w-sm rounded-control border border-rule bg-surface px-3 py-2.5 text-[13px] leading-relaxed text-ink-soft shadow-[0_12px_32px_-12px_rgba(24,33,47,0.35)]',
              className,
            )}
          >
            {children}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}

export function Tooltip({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <HoverCard trigger={children} interactive={false} className="max-w-xs bg-ink px-2 py-1 text-[12px] text-white">
      {label}
    </HoverCard>
  );
}

/* Toasts --------------------------------------------------------------------------------------------- */

interface Toast {
  id: number;
  message: string;
  tone: 'neutral' | 'success' | 'error';
}

const ToastContext = createContext<{ push: (message: string, tone?: Toast['tone']) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);
  const push = useCallback((message: string, tone: Toast['tone'] = 'neutral') => {
    const id = ++counter.current;
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 7000 : 4000);
  }, []);
  const value = useMemo(() => ({ push }), [push]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              'pointer-events-auto rounded-control border px-4 py-3 text-sm shadow-[0_12px_32px_-12px_rgba(24,33,47,0.35)]',
              t.tone === 'error' ? 'border-brick/30 bg-brick-tint text-brick' : t.tone === 'success' ? 'border-jade/30 bg-surface text-ink' : 'border-rule bg-ink text-white',
            )}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast outside ToastProvider');
  return ctx.push;
}

/* Tag input --------------------------------------------------------------------------------------------- */

export function TagInput({
  value,
  onChange,
  placeholder,
  suggestions = [],
  max = 30,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  suggestions?: string[];
  max?: number;
}) {
  const [draft, setDraft] = useState('');
  const add = (raw: string) => {
    const v = raw.trim().replace(/,$/, '').trim();
    if (!v || value.some((x) => x.toLowerCase() === v.toLowerCase()) || value.length >= max) return;
    onChange([...value, v]);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add(draft);
      setDraft('');
    } else if (e.key === 'Backspace' && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  };
  const unused = suggestions.filter((s) => !value.some((v) => v.toLowerCase() === s.toLowerCase())).slice(0, 8);
  return (
    <div>
      <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-control border border-rule-strong bg-surface px-2 py-1.5 focus-within:border-cobalt focus-within:ring-2 focus-within:ring-cobalt/15">
        {value.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 rounded-full bg-ink/[0.06] py-0.5 pr-1 pl-2.5 text-[13px] text-ink">
            {v}
            <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(value.filter((x) => x !== v))} className="rounded-full p-0.5 text-graphite hover:bg-ink/10 hover:text-ink">
              <LuX className="size-3" />
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          onBlur={() => {
            if (draft.trim()) {
              add(draft);
              setDraft('');
            }
          }}
          placeholder={value.length ? '' : placeholder}
          className="min-w-32 flex-1 bg-transparent px-1 text-sm text-ink placeholder:text-mist focus:outline-none"
        />
      </div>
      {unused.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {unused.map((s) => (
            <button key={s} type="button" onClick={() => add(s)} className="rounded-full border border-dashed border-rule-strong px-2.5 py-0.5 text-[12px] text-graphite hover:border-mist hover:text-ink">
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* Link tabs ----------------------------------------------------------------------------------------------- */

export function LinkTabs({ tabs, active }: { tabs: { key: string; label: ReactNode; href: string; badge?: ReactNode }[]; active: string }) {
  return (
    <nav className="-mb-px flex gap-1 overflow-x-auto border-b border-rule" aria-label="Sections">
      {tabs.map((t) => (
        <Link
          key={t.key}
          to={t.href}
          aria-current={t.key === active ? 'page' : undefined}
          className={cn(
            'inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm transition-colors',
            t.key === active ? 'border-ink font-medium text-ink' : 'border-transparent text-graphite hover:text-ink',
          )}
        >
          {t.label}
          {t.badge}
        </Link>
      ))}
    </nav>
  );
}

export function SegmentedControl<T extends string>({ options, value, onChange }: { options: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-control border border-rule-strong bg-surface p-0.5" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-[5px] px-2.5 py-1 text-[13px] transition-colors [&>svg]:size-3.5',
            o.value === value ? 'bg-ink text-white' : 'text-graphite hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
