import './globals.css'
import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { getCurrentUser } from '@/lib/auth'
import { logoutAction } from '@/app/actions/auth'

export const metadata: Metadata = {
  title: 'Ghurza — made-to-order tailoring',
  description: 'Describe a piece, compare blind bids from tailors, pay through a provider, follow it to the finished garment.',
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  // The nav is a convenience only. Every page and action checks access for itself;
  // the layout is never used as a security gate.
  const user = await getCurrentUser()
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <div className="wrap">
            <Link href="/" className="brand" aria-label="Ghurza home">
              <span className="brand-mark" aria-hidden>
                غ
              </span>
              Ghurza
            </Link>
            {user?.role === 'CUSTOMER' && (
              <nav className="nav" aria-label="Main">
                <Link href="/customer/requests">My requests</Link>
                <Link href="/customer/requests/new">New request</Link>
                <Link href="/customer/orders">Orders</Link>
              </nav>
            )}
            {user?.role === 'TAILOR' && (
              <nav className="nav" aria-label="Main">
                <Link href="/tailor/requests">Open requests</Link>
                <Link href="/tailor/bids">My bids</Link>
                <Link href="/tailor/orders">Orders</Link>
                <Link href="/tailor/profile">Profile</Link>
              </nav>
            )}
            <span className="spacer" />
            {user ? (
              <span className="who">
                <span>
                  {user.displayName} · {user.role === 'TAILOR' ? 'Tailor' : 'Customer'}
                </span>
                <form action={logoutAction} className="inline">
                  <button type="submit" className="btn link">
                    Sign out
                  </button>
                </form>
              </span>
            ) : (
              <nav className="nav">
                <Link href="/login">Sign in</Link>
                <Link href="/signup">Create account</Link>
              </nav>
            )}
          </div>
        </header>
        <main>
          <div className="wrap">{children}</div>
        </main>
      </body>
    </html>
  )
}
