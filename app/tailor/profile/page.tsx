import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth'
import { getOwnProfile } from '@/lib/profiles'
import { updateProfileAction } from '@/app/tailor/actions'
import { ActionForm } from '@/components/ActionForm'
import { SubmitButton } from '@/components/SubmitButton'

export default async function TailorProfilePage() {
  const me = await requireRole('TAILOR')
  const profile = await getOwnProfile(me.id)
  if (!profile) notFound()
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Public profile</div>
          <h1>Your profile</h1>
          <p className="lede">
            Rating, completed count and portfolio are calculated from real orders and reviews; they can&apos;t be edited here.{' '}
            <Link href={`/tailors/${me.id}`}>View public page →</Link>
          </p>
        </div>
      </div>
      <div className="card" style={{ maxWidth: 640 }}>
        <ActionForm action={updateProfileAction}>
          <div className="field">
            <label htmlFor="displayName">Display name</label>
            <input id="displayName" name="displayName" required minLength={2} maxLength={60} defaultValue={profile.displayName} />
          </div>
          <div className="field">
            <label htmlFor="city">City</label>
            <input id="city" name="city" maxLength={60} defaultValue={profile.tailorProfile?.city ?? ''} />
          </div>
          <div className="field">
            <label htmlFor="bio">Bio</label>
            <textarea id="bio" name="bio" maxLength={1000} defaultValue={profile.tailorProfile?.bio ?? ''} />
          </div>
          <SubmitButton pendingText="Saving…">Save profile</SubmitButton>
        </ActionForm>
      </div>
    </>
  )
}
