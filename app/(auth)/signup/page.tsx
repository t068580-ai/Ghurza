import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser, roleHome } from '@/lib/auth'
import { signupAction } from '@/app/actions/auth'
import { ActionForm } from '@/components/ActionForm'
import { SubmitButton } from '@/components/SubmitButton'

export default async function SignupPage() {
  const user = await getCurrentUser()
  if (user) redirect(roleHome(user.role))
  return (
    <div style={{ maxWidth: 460, margin: '24px auto' }}>
      <h1>Create an account</h1>
      <p className="muted">Pick your role once. It can&apos;t be changed later, so a customer account can never act as a tailor.</p>
      <div className="card">
        <ActionForm action={signupAction}>
          <fieldset className="field" style={{ border: 0, padding: 0, margin: '0 0 14px' }}>
            <legend style={{ fontWeight: 600, fontSize: '0.88rem', marginBottom: 6 }}>I am a…</legend>
            <div className="row">
              <label className="row" style={{ fontWeight: 500, gap: 6 }}>
                <input type="radio" name="role" value="CUSTOMER" defaultChecked style={{ width: 'auto' }} /> Customer
              </label>
              <label className="row" style={{ fontWeight: 500, gap: 6 }}>
                <input type="radio" name="role" value="TAILOR" style={{ width: 'auto' }} /> Tailor
              </label>
            </div>
          </fieldset>
          <div className="field">
            <label htmlFor="displayName">Your name</label>
            <input id="displayName" name="displayName" required minLength={2} maxLength={60} autoComplete="name" />
          </div>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" required maxLength={254} autoComplete="username" />
          </div>
          <div className="field">
            <label htmlFor="password">
              Password <span className="hint">at least 12 characters</span>
            </label>
            <input id="password" name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password" />
          </div>
          <SubmitButton block pendingText="Creating…">
            Create account
          </SubmitButton>
        </ActionForm>
      </div>
      <p className="small muted" style={{ marginTop: 14 }}>
        Already registered? <Link href="/login">Sign in</Link>
      </p>
    </div>
  )
}
