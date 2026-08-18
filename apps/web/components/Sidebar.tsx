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

const adminNav = [
  { href: '/inbox', label: 'Inbox' },
  { href: '/settings', label: 'Settings' },
  { href: '/settings/team', label: 'Team' },
  { href: '/settings/knowledge', label: 'Knowledge Base' },
  { href: '/settings/billing', label: 'Billing' },
];

export function Sidebar({ role, name, email }: Props) {
  const pathname = usePathname();
  const nav = role === 'admin' ? adminNav : agentNav;

  return (
    <aside className="w-56 bg-white border-r border-gray-200 flex flex-col shrink-0">
      <div className="px-4 py-5 border-b border-gray-100">
        <span className="font-bold text-gray-900 text-lg">Telecomm</span>
      </div>
      <nav className="flex-1 p-3 space-y-0.5">
        {nav.map(({ href, label }) => {
          const active = pathname === href || pathname.startsWith(href + '/');
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                active
                  ? 'bg-indigo-50 text-indigo-700'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              }`}
            >
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="p-3 border-t border-gray-100">
        <div className="px-3 py-2">
          <p className="text-sm font-medium text-gray-900 truncate">{name}</p>
          <p className="text-xs text-gray-500 truncate">{email}</p>
          <p className="text-xs text-indigo-600 mt-0.5 capitalize">{role}</p>
        </div>
        <form action={logoutAction}>
          <button
            type="submit"
            className="w-full mt-1 text-left px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 hover:text-gray-900 rounded-lg transition-colors"
          >
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
