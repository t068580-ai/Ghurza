import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser, roleHome } from '@/lib/auth'

export default async function Home() {
  const user = await getCurrentUser()
  if (user) redirect(roleHome(user.role))

  return (
    <>
      <section className="hero">
        <div className="eyebrow">Made to order · Kuwait</div>
        <h1>Describe the piece. Tailors bid blind. You choose.</h1>
        <p className="lede">
          Post what you want made. Tailors quote a price and a timeline without seeing each other&apos;s numbers. Pay the
          deposit through the payment provider, talk to your tailor, and pay the rest when it&apos;s ready.
        </p>
        <div className="row" style={{ marginTop: 18 }}>
          <Link className="btn" href="/signup">
            Create an account
          </Link>
          <Link className="btn secondary" href="/login">
            Sign in
          </Link>
        </div>
      </section>
      <section className="grid-3" aria-label="How it works">
        <div className="card">
          <div className="eyebrow">01 · Request</div>
          <h3>Say what you want</h3>
          <p className="muted small">Title, fabric, fit, budget, a reference photo. Metadata is stripped from photos before they are stored.</p>
        </div>
        <div className="card">
          <div className="eyebrow">02 · Blind bids</div>
          <h3>Compare honest quotes</h3>
          <p className="muted small">
            Tailors only see how many bids exist and the lowest figure — never who bid or what they quoted. You see every
            revision of every bid.
          </p>
        </div>
        <div className="card">
          <div className="eyebrow">03 · Paid & tracked</div>
          <h3>Follow it through</h3>
          <p className="muted small">An order opens only when the provider confirms your deposit. Chat unlocks then, not before.</p>
        </div>
      </section>
    </>
  )
}
