'use client'

// Generic error page: no stack traces or internals are shown to the user.
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="card empty" style={{ maxWidth: 520, margin: '40px auto' }}>
      <h1>Something went wrong</h1>
      <p>Please try again. If it keeps happening, reload the page.</p>
      <button className="btn secondary" onClick={() => reset()}>
        Try again
      </button>
    </div>
  )
}
