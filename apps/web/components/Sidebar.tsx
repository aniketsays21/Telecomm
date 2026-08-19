'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { logoutAction } from '@/lib/actions';
import { DemoToggle } from './DemoToggle';

type Props = {
  role: string;
  name: string;
  email: string;
};

const agentNav = [
  { href: '/inbox', label: 'Inbox' },
];

// Sidebar structure per admin request. Sections read top → bottom:
// what you look at every day (Work), where messages come from (Manage),
// how the workspace is tuned (Configure).
const adminNavGroups: Array<{ eyebrow: string; items: { href: string; label: string }[] }> = [
  {
    eyebrow: 'Work',
    items: [
      { href: '/analytics',     label: 'Dashboard' },
      { href: '/inbox',         label: 'Inbox' },
      { href: '/settings/team', label: 'Team' },
    ],
  },
  {
    eyebrow: 'Manage',
    items: [
      { href: '/settings/widget',   label: 'Chat widget' },
      { href: '/settings/gmail',    label: 'Gmail' },
      { href: '/settings/triggers', label: 'Proactive triggers' },
    ],
  },
  {
    eyebrow: 'Configure',
    items: [
      { href: '/settings/knowledge', label: 'Knowledge base' },
      { href: '/settings/webhooks',  label: 'Webhooks' },
      { href: '/settings/canned',    label: 'Canned replies' },
      { href: '/settings/sla',       label: 'SLA' },
    ],
  },
];

export function Sidebar({ role, name, email }: Props) {
  const pathname = usePathname();

  return (
    <aside
      className="w-64 shrink-0 flex flex-col border-r"
      style={{ background: 'var(--paper)', borderColor: 'var(--rule)' }}
    >
      {/* Wordmark — clean sans, single accent dot */}
      <div className="px-5 pt-6 pb-4" style={{ borderBottom: '1px solid var(--rule-2)' }}>
        <div className="flex items-center gap-2">
          <div
            className="w-7 h-7 rounded-md flex items-center justify-center text-white text-sm font-semibold"
            style={{ background: 'var(--forest)' }}
          >
            T
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-tight" style={{ color: 'var(--ink)' }}>Telecomm</p>
            <p className="text-[10px] leading-tight" style={{ color: 'var(--dust)' }}>Customer support</p>
          </div>
        </div>
        {role === 'admin' && (
          <div className="mt-4">
            <DemoToggle />
          </div>
        )}
      </div>

      <nav className="flex-1 px-3 pt-4 pb-4 overflow-y-auto">
        {role === 'admin' ? (
          adminNavGroups.map((group, i) => (
            <div key={group.eyebrow} className={i === 0 ? '' : 'mt-6'}>
              <p className="eyebrow px-3 mb-2">{group.eyebrow}</p>
              <ul className="space-y-0.5">
                {group.items.map((item) => (
                  <NavItem key={item.href} href={item.href} label={item.label} pathname={pathname} />
                ))}
              </ul>
            </div>
          ))
        ) : (
          <ul className="space-y-0.5 mt-2">
            {agentNav.map((item) => (
              <NavItem key={item.href} href={item.href} label={item.label} pathname={pathname} />
            ))}
          </ul>
        )}
      </nav>

      {/* User card */}
      <div className="px-3 py-3 border-t" style={{ borderColor: 'var(--rule-2)' }}>
        <div className="px-3 py-2 rounded-md" style={{ background: 'var(--rule-2)' }}>
          <div className="flex items-center gap-2.5">
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold shrink-0"
              style={{ background: 'var(--forest)', color: 'var(--paper)' }}
            >
              {name[0]?.toUpperCase() ?? '?'}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium truncate" style={{ color: 'var(--ink)' }}>{name}</p>
              <p className="text-[11px] truncate" style={{ color: 'var(--ash)' }}>{email}</p>
            </div>
          </div>
        </div>
        <form action={logoutAction} className="mt-1">
          <button
            type="submit"
            className="w-full text-left px-3 py-1.5 text-xs rounded transition-colors hover:bg-slate-100"
            style={{ color: 'var(--ash)' }}
          >
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}

function NavItem({ href, label, pathname }: { href: string; label: string; pathname: string }) {
  const active = pathname === href || pathname.startsWith(href + '/');
  return (
    <li>
      <Link
        href={href}
        className="group flex items-center gap-2.5 px-3 py-1.5 text-sm rounded-md transition-colors"
        style={{
          color: active ? 'var(--forest)' : 'var(--ash)',
          background: active ? 'var(--forest-soft)' : 'transparent',
          fontWeight: active ? 500 : 400,
        }}
        onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--rule-2)'; }}
        onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
      >
        {label}
      </Link>
    </li>
  );
}
