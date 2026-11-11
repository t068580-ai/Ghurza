// Runs once when the server starts. Validating the environment here means a
// missing or weak secret stops the app at boot rather than at the first payment.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { env } = await import('./lib/env')
    env()
  }
}
