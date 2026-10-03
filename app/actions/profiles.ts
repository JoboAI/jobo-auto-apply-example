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
import { profileIssues } from '@/lib/resume/completeness'
import { z } from 'zod'

/**
 * Profile edits. New profiles are created by the upload route
 * (app/api/profiles/import), not here. Every action re-checks ownership, and
 * validates its arguments: server actions are public HTTP endpoints.
 */

const profileIdInput = z.string().min(1).max(100)
const updateInput = z.object({
  name: z.string().max(200).optional(),
  // Checked in full against resumeProfileSchema below, with a readable error.
  data: z.unknown().optional(),
  confirm: z.boolean().optional(),
})

export async function updateProfileAction(
  rawId: string,
  rawUpdate: { name?: string; data?: ResumeProfile; confirm?: boolean },
): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser()
  const parsedId = profileIdInput.safeParse(rawId)
  const parsedUpdate = updateInput.safeParse(rawUpdate)
  if (!parsedId.success || !parsedUpdate.success) return { ok: false, error: 'Invalid request.' }
  const id = parsedId.data
  const update = parsedUpdate.data
  const where = and(eq(profiles.id, id), eq(profiles.userId, user.id), eq(profiles.archived, false))
  const [row] = await db.select().from(profiles).where(where).limit(1)
  if (!row) return { ok: false, error: 'Profile not found.' }
  const parsed = resumeProfileSchema.safeParse(update.data ?? row.data)
  if (!parsed.success)
    return {
      ok: false,
      error: 'Please check the profile fields and try again.',
    }
  const data = normalizeProfile(parsed.data)
  const missing = profileIssues(data)
  if ((update.confirm || row.reviewedAt) && missing.length)
    return {
      ok: false,
      error: missing.join(' '),
    }
  await db
    .update(profiles)
    .set({
      name: update.name?.trim().slice(0, 100) || row.name,
      data,
      reviewedAt: update.confirm || row.reviewedAt ? Date.now() : null,
      updatedAt: Date.now(),
    })
    .where(where)
  revalidatePath('/profiles')
  revalidatePath(`/profiles/${id}`)
  revalidatePath('/jobs')
  revalidatePath('/saved')
  return { ok: true }
}
export async function setDefaultProfileAction(rawId: string) {
  const user = await requireUser()
  const parsed = profileIdInput.safeParse(rawId)
  if (!parsed.success) return { ok: false }
  const id = parsed.data
  const found = await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(profiles)
      .where(and(eq(profiles.id, id), eq(profiles.userId, user.id), eq(profiles.archived, false)))
      .limit(1)
    if (!row) return false
    await tx.update(profiles).set({ isDefault: false }).where(eq(profiles.userId, user.id))
    await tx.update(profiles).set({ isDefault: true }).where(eq(profiles.id, id))
    return true
  })
  if (!found) return { ok: false }
  revalidatePath('/profiles')
  return { ok: true }
}
/** Archive, not delete: past applications keep pointing at the profile. */
export async function deleteProfileAction(rawId: string) {
  const user = await requireUser()
  const parsed = profileIdInput.safeParse(rawId)
  if (!parsed.success) return { ok: false }
  const id = parsed.data
  await db.transaction(async (tx) => {
    await tx
      .update(profiles)
      .set({ archived: true, isDefault: false })
      .where(and(eq(profiles.id, id), eq(profiles.userId, user.id)))
    const rows = await tx
      .select()
      .from(profiles)
      .where(and(eq(profiles.userId, user.id), eq(profiles.archived, false)))
    if (rows.length && !rows.some((r) => r.isDefault))
      await tx.update(profiles).set({ isDefault: true }).where(eq(profiles.id, rows[0].id))
  })
  revalidatePath('/profiles')
  return { ok: true }
}
