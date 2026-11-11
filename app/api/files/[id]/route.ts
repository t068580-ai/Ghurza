import { getCurrentUser } from '@/lib/auth'
import { canViewUpload, loadUploadForCheck } from '@/lib/authz'
import { readStored } from '@/lib/uploads'
import { idSchema } from '@/lib/validation'

export const dynamic = 'force-dynamic'

function notFound() {
  return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } })
}

// Uploaded images are served only through here, after an authorization check.
// Headers make sure the browser treats the bytes strictly as an image:
//  - Content-Type from our own allowlist (decided from magic bytes at upload time)
//  - nosniff: no guessing that it's HTML or script
//  - CSP sandbox: even if opened directly, nothing in it can run
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!idSchema.safeParse(id).success) return notFound()

  const viewer = await getCurrentUser()
  const upload = await loadUploadForCheck(id, viewer?.id ?? null)
  if (!upload) return notFound()
  const { allowed, isPublic } = canViewUpload(viewer, upload)
  if (!allowed) return notFound() // same response as "doesn't exist"

  if (upload.mimeType !== 'image/jpeg' && upload.mimeType !== 'image/png') return notFound()
  const body = await readStored(upload.storedName)
  if (!body) return notFound()

  return new Response(new Uint8Array(body), {
    headers: {
      'Content-Type': upload.mimeType,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Content-Disposition': `inline; filename="${upload.id}.${upload.mimeType === 'image/png' ? 'png' : 'jpg'}"`,
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Cache-Control': isPublic ? 'public, max-age=3600' : 'private, no-store',
    },
  })
}
