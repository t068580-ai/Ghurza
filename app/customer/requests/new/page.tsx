import { requireRole } from '@/lib/auth'
import { PIECE_LABELS, PIECE_TYPES } from '@/lib/enums'
import { createRequestAction } from '@/app/customer/actions'
import { ActionForm } from '@/components/ActionForm'
import { SubmitButton } from '@/components/SubmitButton'

export default async function NewRequestPage() {
  await requireRole('CUSTOMER')
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Made to order</div>
          <h1>Post a request</h1>
          <p className="lede">Tailors will see this, but never your name or email. They&apos;ll bid without seeing each other&apos;s prices.</p>
        </div>
      </div>
      <div className="card" style={{ maxWidth: 720 }}>
        <ActionForm action={createRequestAction}>
          <div className="field">
            <label htmlFor="title">Title</label>
            <input id="title" name="title" required minLength={3} maxLength={120} placeholder="Navy bisht with gold zari for graduation" />
          </div>
          <div className="field">
            <label htmlFor="pieceType">Piece type</label>
            <select id="pieceType" name="pieceType" required defaultValue="">
              <option value="" disabled>
                Choose a type
              </option>
              {PIECE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {PIECE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="description">
              Description <span className="hint">fabric, cut, colour, details, occasion</span>
            </label>
            <textarea id="description" name="description" required minLength={10} maxLength={4000} />
          </div>
          <div className="fields-2">
            <div className="field">
              <label htmlFor="budgetMin">
                Budget from (KWD) <span className="hint">optional</span>
              </label>
              <input id="budgetMin" name="budgetMin" inputMode="decimal" pattern="\d{1,5}(\.\d{1,3})?" placeholder="60.000" />
            </div>
            <div className="field">
              <label htmlFor="budgetMax">
                Budget to (KWD) <span className="hint">optional</span>
              </label>
              <input id="budgetMax" name="budgetMax" inputMode="decimal" pattern="\d{1,5}(\.\d{1,3})?" placeholder="120.000" />
            </div>
          </div>
          <div className="field">
            <label htmlFor="neededBy">
              Needed by <span className="hint">optional</span>
            </label>
            <input id="neededBy" name="neededBy" type="date" />
          </div>
          <div className="field">
            <label htmlFor="photo">
              Reference photo <span className="hint">optional · JPEG or PNG · up to 5 MB · location data is removed</span>
            </label>
            <input id="photo" name="photo" type="file" accept="image/jpeg,image/png" />
          </div>
          <SubmitButton pendingText="Posting…">Post request</SubmitButton>
        </ActionForm>
      </div>
    </>
  )
}
