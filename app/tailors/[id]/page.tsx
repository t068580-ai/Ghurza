import { notFound } from 'next/navigation'
import { getTailorProfile } from '@/lib/profiles'
import { fileUrl } from '@/lib/uploads'
import { idSchema } from '@/lib/validation'
import { pieceLabel } from '@/lib/enums'
import { Stars, formatDate } from '@/components/ui'

// Public. Selects only public fields: never email, never anything private.
export default async function TailorPublicPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!idSchema.safeParse(id).success) notFound()
  const t = await getTailorProfile(id)
  if (!t) notFound()

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Tailor{t.city ? ` · ${t.city}` : ''}</div>
          <h1>{t.displayName}</h1>
          {t.bio && <p className="lede" style={{ whiteSpace: 'pre-wrap' }}>{t.bio}</p>}
        </div>
      </div>
      <div className="grid-3" style={{ marginBottom: 18 }}>
        <div className="stat">
          <div className="stat-label">Rating</div>
          <div className="stat-value">{t.rating != null ? `${t.rating.toFixed(1)} ★` : '—'}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Reviews</div>
          <div className="stat-value">{t.reviewCount}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Pieces completed</div>
          <div className="stat-value">{t.completedCount}</div>
        </div>
      </div>

      <div className="card">
        <h2>Work</h2>
        {t.portfolio.length === 0 ? (
          <p className="muted">Finished pieces appear here after completed orders.</p>
        ) : (
          <div className="portfolio">
            {t.portfolio.map((p) => (
              <figure key={p.uploadId} style={{ margin: 0 }}>
                <img src={fileUrl(p.uploadId)!} alt={p.title} />
                <figcaption className="small muted" style={{ marginTop: 4 }}>
                  {pieceLabel(p.pieceType)} · {p.days} days
                </figcaption>
              </figure>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h2>What customers said</h2>
        {t.reviews.length === 0 ? (
          <p className="muted">No reviews yet.</p>
        ) : (
          t.reviews.map((r, i) => (
            <div key={i} className="item" style={{ display: 'block' }}>
              <Stars value={r.rating} />
              <p style={{ margin: '4px 0', whiteSpace: 'pre-wrap' }}>“{r.text}”</p>
              <div className="muted small">
                {r.by} · {formatDate(r.createdAt)}
              </div>
            </div>
          ))
        )}
      </div>
    </>
  )
}
