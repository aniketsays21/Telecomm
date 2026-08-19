'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { logoutAction } from '@/lib/actions';

type Props = {
  role: string;
  name: string;
  email: string;
};

const agentNav = [
  { href: '/inbox', label: 'Inbox' },
];

// Grouped so the sidebar reads like a table of contents, not a wall of items.
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
    eyebrow: 'Channels',
    items: [
      { href: '/settings/widget',   label: 'Chat widget' },
      { href: '/settings/email',    label: 'Email' },
      { href: '/settings/gmail',    label: 'Gmail' },
      { href: '/settings/triggers', label: 'Proactive triggers' },
    ],
  },
  {
    eyebrow: 'Configure',
    items: [
      { href: '/settings/knowledge', label: 'Knowledge' },
      { href: '/settings/canned',    label: 'Canned replies' },
      { href: '/settings/sla',       label: 'SLA' },
      { href: '/settings/webhooks',  label: 'Webhooks' },
    ],
  },
];

export function Sidebar({ role, name, email }: Props) {
  const pathname = usePathname();

  return (
    <aside
      className="w-60 shrink-0 flex flex-col border-r"
      style={{ background: 'var(--paper)', borderColor: 'var(--rule)' }}
    >
      {/* Wordmark — serif italic for character, small dot for the "T" opener */}
      <div className="px-6 pt-7 pb-5">
        <div className="flex items-baseline gap-1.5">
          <span className="font-display text-2xl italic" style={{ color: 'var(--ink)' }}>
            Telecomm
          </span>
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: 'var(--forest)' }}
            aria-hidden="true"
          />
        </div>
        <p className="eyebrow mt-1" style={{ color: 'var(--dust)' }}>Support · v1</p>
      </div>

      <nav className="flex-1 px-4 pb-4 overflow-y-auto">
        {role === 'admin' ? (
          adminNavGroups.map((group, i) => (
            <div key={group.eyebrow} className={i === 0 ? '' : 'mt-6'}>
              <p className="eyebrow px-2 mb-2">{group.eyebrow}</p>
              <ul className="space-y-px">
                {group.items.map((item) => (
                  <NavItem key={item.href} href={item.href} label={item.label} pathname={pathname} />
                ))}
              </ul>
            </div>
          ))
        ) : (
          <ul className="space-y-px mt-2">
            {agentNav.map((item) => (
              <NavItem key={item.href} href={item.href} label={item.label} pathname={pathname} />
            ))}
          </ul>
        )}
      </nav>

      {/* User card — separated by a hairline, not a shaded block */}
      <div className="px-4 py-4 border-t" style={{ borderColor: 'var(--rule)' }}>
        <div className="px-2">
          <p className="text-sm font-medium truncate" style={{ color: 'var(--ink)' }}>{name}</p>
          <p className="text-xs truncate mt-0.5" style={{ color: 'var(--ash)' }}>{email}</p>
          <p className="eyebrow mt-1.5" style={{ color: 'var(--forest)' }}>{role}</p>
        </div>
        <form action={logoutAction} className="mt-3">
          <button
            type="submit"
            className="w-full text-left px-2 py-1.5 text-sm rounded transition-colors"
            style={{ color: 'var(--ash)' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--brick)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--ash)')}
          >
            Sign out ↗
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
        className="group flex items-center gap-2.5 px-2 py-1.5 text-sm transition-colors rounded"
        style={{
          color: active ? 'var(--ink)' : 'var(--ash)',
          background: active ? 'var(--forest-soft)' : 'transparent',
          fontWeight: active ? 500 : 400,
        }}
      >
        {/* Small marker replaces the pill background */}
        <span
          aria-hidden="true"
          className="w-1 h-1 rounded-full transition-all"
          style={{
            background: active ? 'var(--forest)' : 'transparent',
            outline: active ? 'none' : '1px solid var(--rule)',
          }}
        />
        {label}
      </Link>
    </li>
  );
}
