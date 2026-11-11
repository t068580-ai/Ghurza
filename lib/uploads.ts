import 'server-only'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises'
import path from 'node:path'
import { inspectImage } from './image'

// Uploaded images live OUTSIDE /public, in ./uploads, and are only served by
// app/api/files/[id]/route.ts after an authorization check. File names are
// generated here (uuid + known extension), never taken from the user.

export const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads')
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024 // 5 MiB

export type StoredImage = {
  storedName: string
  mimeType: string
  sizeBytes: number
  width: number
  height: number
  sha256: string
}

// Returns null when no file was chosen; throws UploadError with a user-safe message
// when the file is unacceptable.
export class UploadError extends Error {}

export function pickFile(fd: FormData, field: string): File | null {
  const v = fd.get(field)
  if (!v || typeof v === 'string') return null
  if (v.size === 0 && !v.name) return null // empty <input type="file">
  return v
}

export async function storeImage(file: File): Promise<StoredImage> {
  if (file.size === 0) throw new UploadError('The file is empty.')
  if (file.size > MAX_UPLOAD_BYTES) throw new UploadError('Images must be 5 MB or smaller.')
  const info = inspectImage(Buffer.from(await file.arrayBuffer()))
  if (!info) throw new UploadError('Only JPEG or PNG photos up to 6000×6000 px are accepted.')

  await mkdir(UPLOAD_DIR, { recursive: true })
  const storedName = `${randomUUID()}.${info.ext}`
  const full = path.resolve(UPLOAD_DIR, storedName)
  if (!full.startsWith(UPLOAD_DIR + path.sep)) throw new UploadError('Invalid file name.')
  await writeFile(full, info.clean, { flag: 'wx' })
  return {
    storedName,
    mimeType: info.mime,
    sizeBytes: info.clean.length,
    width: info.width,
    height: info.height,
    sha256: createHash('sha256').update(info.clean).digest('hex'),
  }
}

// Called when the database insert that should reference a stored file fails.
export async function discardStored(storedName: string): Promise<void> {
  if (!/^[0-9a-f-]{36}\.(jpg|png)$/.test(storedName)) return
  await unlink(path.resolve(UPLOAD_DIR, storedName)).catch(() => {})
}

export async function readStored(storedName: string): Promise<Buffer | null> {
  if (!/^[0-9a-f-]{36}\.(jpg|png)$/.test(storedName)) return null
  const full = path.resolve(UPLOAD_DIR, storedName)
  if (!full.startsWith(UPLOAD_DIR + path.sep)) return null
  return readFile(full).catch(() => null)
}

export function fileUrl(uploadId: string | null | undefined): string | null {
  return uploadId ? `/api/files/${uploadId}` : null
}
