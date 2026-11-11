import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser, roleHome } from '@/lib/auth'
import { loginAction } from '@/app/actions/auth'
import { ActionForm } from '@/components/ActionForm'
import { SubmitButton } from '@/components/SubmitButton'

export default async function LoginPage() {
  const user = await getCurrentUser()
  if (user) redirect(roleHome(user.role))
  return (
    <div style={{ maxWidth: 420, margin: '24px auto' }}>
      <h1>Sign in</h1>
      <p className="muted">Customers land on their requests; tailors land on open requests.</p>
      <div className="card">
        <ActionForm action={loginAction}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" autoComplete="username" required maxLength={254} />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" name="password" type="password" autoComplete="current-password" required maxLength={256} />
          </div>
          <SubmitButton block pendingText="Signing in…">
            Sign in
          </SubmitButton>
        </ActionForm>
      </div>
      <p className="small muted" style={{ marginTop: 14 }}>
        New here? <Link href="/signup">Create an account</Link>
      </p>
    </div>
  )
}
