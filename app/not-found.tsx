import Link from 'next/link'

// Also what you get for something that exists but isn't yours: the app never says
// "forbidden", so ids can't be probed to learn what exists.
export default function NotFound() {
  return (
    <div className="card empty" style={{ maxWidth: 520, margin: '40px auto' }}>
      <h1>Not found</h1>
      <p>This page doesn&apos;t exist, or it isn&apos;t yours to see.</p>
      <Link className="btn secondary" href="/">
        Go home
      </Link>
    </div>
  )
}
