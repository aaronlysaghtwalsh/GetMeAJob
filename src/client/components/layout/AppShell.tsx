import { useState, type ReactNode } from 'react';
import { LuBrain, LuBriefcase, LuLayoutDashboard, LuLogOut, LuMap, LuMenu, LuPlus, LuSettings, LuX, LuKeyRound } from 'react-icons/lu';
import { Link, useLocation } from '../../lib/router';
import { useAuth } from '../../lib/auth';
import { useQuery } from '../../lib/query';
import { cn } from '../ui/cn';
import { Menu } from '../ui/overlays';

const NAV = [
  { href: '/', label: 'Today', icon: <LuLayoutDashboard />, match: (p: string) => p === '/' },
  { href: '/brain', label: 'Career Brain', icon: <LuBrain />, match: (p: string) => p.startsWith('/brain') },
  { href: '/applications', label: 'Applications', icon: <LuBriefcase />, match: (p: string) => p.startsWith('/applications') && p !== '/applications/new' },
  { href: '/settings', label: 'Settings', icon: <LuSettings />, match: (p: string) => p.startsWith('/settings') },
];

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <img src="/favicon.svg" alt="" className="size-6" />
      <span className="font-display text-[19px] font-semibold tracking-[-0.01em] text-ink">GetMeAJob</span>
    </span>
  );
}

function AiStatusNote() {
  const { data } = useQuery<{ configured: boolean; message: string | null }>('/api/settings/ai');
  if (!data || data.configured) return null;
  return (
    <Link to="/settings" className="mx-3 mb-3 flex items-start gap-2 rounded-control border border-ochre/30 bg-ochre-tint/70 px-3 py-2.5 text-[13px] leading-snug text-ink-soft hover:border-ochre/50">
      <LuKeyRound className="mt-0.5 size-4 shrink-0 text-ochre" />
      <span>
        <span className="font-medium text-ink">Connect an AI provider</span>
        <span className="block text-graphite">Add your API key to start building applications.</span>
      </span>
    </Link>
  );
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const { path } = useLocation();
  return (
    <nav className="flex flex-col gap-0.5 px-3" aria-label="Main">
      {NAV.map((item) => {
        const active = item.match(path);
        return (
          <Link
            key={item.href}
            to={item.href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center gap-2.5 rounded-control px-2.5 py-2 text-sm transition-colors [&>svg]:size-[18px]',
              active ? 'bg-ink/[0.07] font-medium text-ink [&>svg]:text-ink' : 'text-graphite hover:bg-ink/[0.04] hover:text-ink [&>svg]:text-mist',
            )}
          >
            {item.icon}
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { user, logout } = useAuth();
  const { path } = useLocation();
  return (
    <div className="flex h-full flex-col">
      <div className="px-5 pt-5 pb-5">
        <Link to="/" onClick={onNavigate} aria-label="GetMeAJob home">
          <Wordmark />
        </Link>
      </div>
      <div className="px-3 pb-4">
        <Link
          to="/applications/new"
          onClick={onNavigate}
          className={cn(
            'flex h-9 items-center justify-center gap-2 rounded-control bg-ink text-sm font-medium text-white hover:bg-ink-soft',
            path === '/applications/new' && 'ring-2 ring-cobalt/30',
          )}
        >
          <LuPlus className="size-4" />
          New application
        </Link>
      </div>
      <NavList onNavigate={onNavigate} />
      <div className="mt-auto pt-6">
        <AiStatusNote />
        <div className="px-3">
          <Link
            to="/roadmap"
            onClick={onNavigate}
            className={cn(
              'flex items-center gap-2.5 rounded-control px-2.5 py-2 text-sm [&>svg]:size-[18px]',
              path === '/roadmap' ? 'bg-ink/[0.07] font-medium text-ink' : 'text-graphite hover:bg-ink/[0.04] hover:text-ink [&>svg]:text-mist',
            )}
          >
            <LuMap />
            Roadmap
          </Link>
        </div>
        <div className="mt-2 border-t border-rule px-3 py-3">
          <Menu
            align="start"
            button={
              <button type="button" className="flex w-full items-center gap-2.5 rounded-control px-2 py-1.5 text-left hover:bg-ink/[0.04]">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-jade-tint text-[13px] font-semibold text-jade-strong">
                  {(user?.displayName || user?.email || '?').slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium text-ink">{user?.displayName || 'Your account'}</span>
                  <span className="block truncate text-[12px] text-graphite">{user?.email}</span>
                </span>
              </button>
            }
            items={[
              { label: 'Settings', href: '/settings', icon: <LuSettings /> },
              'divider',
              { label: 'Sign out', onSelect: () => void logout(), icon: <LuLogOut /> },
            ]}
          />
        </div>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[236px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-screen border-r border-rule bg-surface/70 lg:block">
        <SidebarContent />
      </aside>
      <div className="flex items-center justify-between border-b border-rule bg-surface px-4 py-3 lg:hidden">
        <Link to="/" aria-label="GetMeAJob home">
          <Wordmark />
        </Link>
        <button type="button" onClick={() => setOpen(true)} className="rounded p-1.5 text-graphite hover:bg-ink/5" aria-label="Open menu">
          <LuMenu className="size-5" />
        </button>
      </div>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink/30" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-[280px] bg-surface shadow-xl">
            <button type="button" onClick={() => setOpen(false)} className="absolute top-4 right-3 rounded p-1.5 text-graphite hover:bg-ink/5" aria-label="Close menu">
              <LuX className="size-5" />
            </button>
            <SidebarContent onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}
      <main className="min-w-0">
        <div className="mx-auto w-full max-w-[1240px] px-4 py-7 sm:px-6 lg:px-10 lg:py-9">{children}</div>
      </main>
    </div>
  );
}
