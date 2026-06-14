'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'

const NAV = [
  { href: '/dashboard',          label: 'Dashboard',      icon: 'ti-layout-dashboard' },
  { href: '/dashboard/gaps',     label: 'Gap Visualizer', icon: 'ti-chart-radar'      },
  { href: '/dashboard/quiz',     label: 'Quiz',           icon: 'ti-clipboard-check'  },
  { href: '/dashboard/notes',    label: 'Notes',          icon: 'ti-notes'            },
  { href: '/dashboard/history',  label: 'History',        icon: 'ti-history'          },
]

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router   = useRouter()
  const supabase = createClient()

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <div className="min-h-screen flex" style={{ background: 'var(--gw-bg)' }}>

      {/* Sidebar */}
      <aside
        className="flex-shrink-0 flex flex-col py-6 px-3"
        style={{
          width: '200px',
          background: 'var(--gw-bg2)',
          borderRight: '0.5px solid var(--gw-border)',
        }}
      >
        {/* Logo */}
        <div className="flex items-center gap-2 px-3 mb-8">
          <span
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: 'var(--gw-teal)',
              flexShrink: 0,
              display: 'inline-block',
            }}
          />
          <span style={{ fontSize: '15px', fontWeight: 500, color: 'var(--gw-text)' }}>
            Gapwise
          </span>
        </div>

        {/* Nav links */}
        <nav className="flex flex-col gap-0.5 flex-1">
          {NAV.map(({ href, label, icon }) => {
            const active = pathname === href
            return (
              <Link
                key={href}
                href={href}
                className="flex items-center gap-2.5 px-3 py-2 rounded text-sm transition-colors"
                style={{
                  color:       active ? 'var(--gw-text)'  : 'var(--gw-muted)',
                  background:  active ? 'var(--gw-bg3)'   : 'transparent',
                  borderLeft:  active
                    ? '2px solid var(--gw-teal)'
                    : '2px solid transparent',
                  textDecoration: 'none',
                }}
              >
                <i className={`ti ${icon}`} style={{ fontSize: '16px' }} aria-hidden="true" />
                {label}
              </Link>
            )
          })}
        </nav>

        {/* Logout */}
        <button
          onClick={handleLogout}
          className="flex items-center gap-2.5 px-3 py-2 rounded text-sm transition-colors text-left w-full"
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--gw-muted)',
            cursor: 'pointer',
          }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--gw-text)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--gw-muted)')}
        >
          <i className="ti ti-logout" style={{ fontSize: '16px' }} aria-hidden="true" />
          Logout
        </button>
      </aside>

      {/* Page content */}
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>

    </div>
  )
}