'use server'

import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { profiles } from '@/db/schema'
import { deleteResume } from '@/lib/resume/storage'
import { normalizeProfile, type EeoAnswers, type ResumeProfile } from '@/lib/resume/profile-schema'

export async function updateProfileAction(
  id: string,
  update: { name?: string; data?: ResumeProfile; eeo?: EeoAnswers }
): Promise<{ ok: boolean }> {
  db.update(profiles)
    .set({
      ...(update.name ? { name: update.name } : {}),
      // Re-normalise on every write: a hand-edited date should be subject to
      // the same rules as a parsed one.
      ...(update.data ? { data: normalizeProfile(update.data) } : {}),
      ...(update.eeo ? { eeo: update.eeo } : {}),
      updatedAt: Date.now()
    })
    .where(eq(profiles.id, id))
    .run()

  revalidatePath('/profiles')
  revalidatePath(`/profiles/${id}`)
  return { ok: true }
}

/** Update the freeform notes — the field open-ended answers lean on hardest. */
export async function updateNotesAction(id: string, notes: string): Promise<{ ok: boolean }> {
  const profile = db.select().from(profiles).where(eq(profiles.id, id)).get()
  if (!profile) return { ok: false }

  db.update(profiles)
    .set({
      data: { ...profile.data, about: { ...profile.data.about, freeform_notes: notes } },
      updatedAt: Date.now()
    })
    .where(eq(profiles.id, id))
    .run()

  revalidatePath(`/profiles/${id}`)
  return { ok: true }
}

export async function updateEeoAction(id: string, eeo: EeoAnswers): Promise<{ ok: boolean }> {
  db.update(profiles).set({ eeo, updatedAt: Date.now() }).where(eq(profiles.id, id)).run()
  revalidatePath(`/profiles/${id}`)
  return { ok: true }
}

export async function setDefaultProfileAction(id: string): Promise<{ ok: boolean }> {
  db.update(profiles).set({ isDefault: false }).run()
  db.update(profiles).set({ isDefault: true }).where(eq(profiles.id, id)).run()
  revalidatePath('/profiles')
  return { ok: true }
}

export async function deleteProfileAction(id: string): Promise<{ ok: boolean }> {
  db.delete(profiles).where(eq(profiles.id, id)).run()
  await deleteResume(id)
  revalidatePath('/profiles')
  return { ok: true }
}
