import 'server-only'
import { headers } from 'next/headers'
import { env } from './env'

// Next.js already rejects Server Actions whose Origin host differs from the Host
// header, but it lets a request with NO Origin header through with only a warning.
// This check is stricter and is the one our own code relies on:
//   - Sec-Fetch-Site: cross-site  -> reject (modern browsers always send it)
//   - Origin present              -> must equal APP_ORIGIN exactly
// A request with neither header can't come from a browser page on another site,
// so it isn't a CSRF vector (CSRF needs the victim's browser and cookies).
export async function isSameOrigin(): Promise<boolean> {
  const h = await headers()
  const site = h.get('sec-fetch-site')
  if (site === 'cross-site') return false
  const origin = h.get('origin')
  if (origin && origin !== env().APP_ORIGIN) return false
  return true
}
