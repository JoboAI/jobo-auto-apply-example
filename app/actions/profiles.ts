'use server'
import { revalidatePath } from 'next/cache'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { profiles } from '@/db/schema'
import { requireUser } from '@/lib/session'
import {
  normalizeProfile,
  resumeProfileSchema,
  type ResumeProfile,
} from '@/lib/resume/profile-schema'
import { contactIssues } from '@/lib/resume/completeness'

export async function updateProfileAction(
  id: string,
  update: { name?: string; data?: ResumeProfile; confirm?: boolean },
): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser()
  const where = and(
    eq(profiles.id, id),
    eq(profiles.userId, user.id),
    eq(profiles.archived, false),
  )
  const row = db.select().from(profiles).where(where).get()
  if (!row) return { ok: false, error: 'Profile not found.' }
  const parsed = resumeProfileSchema.safeParse(update.data ?? row.data)
  if (!parsed.success)
    return {
      ok: false,
      error: 'Please check the profile fields and try again.',
    }
  const data = normalizeProfile(parsed.data)
  const missing = Object.values(contactIssues(data)).filter(Boolean)
  if ((update.confirm || row.reviewedAt) && missing.length)
    return {
      ok: false,
      error: missing.join(' '),
    }
  db.update(profiles)
    .set({
      name: update.name?.trim().slice(0, 100) || row.name,
      data,
      reviewedAt: update.confirm || row.reviewedAt ? Date.now() : null,
      updatedAt: Date.now(),
    })
    .where(where)
    .run()
  revalidatePath('/profiles')
  revalidatePath(`/profiles/${id}`)
  revalidatePath('/jobs')
  revalidatePath('/saved')
  return { ok: true }
}
export async function updateNotesAction(id: string, notes: string) {
  const user = await requireUser()
  const row = db
    .select()
    .from(profiles)
    .where(
      and(
        eq(profiles.id, id),
        eq(profiles.userId, user.id),
        eq(profiles.archived, false),
      ),
    )
    .get()
  if (!row) return { ok: false }
  return updateProfileAction(id, {
    data: {
      ...row.data,
      about: { ...row.data.about, freeform_notes: notes.slice(0, 10000) },
    },
  })
}
export async function setDefaultProfileAction(id: string) {
  const user = await requireUser()
  return db.transaction((tx) => {
    const row = tx
      .select()
      .from(profiles)
      .where(
        and(
          eq(profiles.id, id),
          eq(profiles.userId, user.id),
          eq(profiles.archived, false),
        ),
      )
      .get()
    if (!row) return { ok: false }
    tx.update(profiles)
      .set({ isDefault: false })
      .where(eq(profiles.userId, user.id))
      .run()
    tx.update(profiles)
      .set({ isDefault: true })
      .where(eq(profiles.id, id))
      .run()
    revalidatePath('/profiles')
    return { ok: true }
  })
}
export async function deleteProfileAction(id: string) {
  const user = await requireUser()
  db.transaction((tx) => {
    tx.update(profiles)
      .set({ archived: true, isDefault: false })
      .where(and(eq(profiles.id, id), eq(profiles.userId, user.id)))
      .run()
    const rows = tx
      .select()
      .from(profiles)
      .where(and(eq(profiles.userId, user.id), eq(profiles.archived, false)))
      .all()
    if (rows.length && !rows.some((r) => r.isDefault))
      tx.update(profiles)
        .set({ isDefault: true })
        .where(eq(profiles.id, rows[0].id))
        .run()
  })
  revalidatePath('/profiles')
  return { ok: true }
}
