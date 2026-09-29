import Link from 'next/link'
import { notFound } from 'next/navigation'
import { and, eq } from 'drizzle-orm'
import { ArrowLeft, Download } from 'lucide-react'
import { db } from '@/db/client'
import { profiles } from '@/db/schema'
import { requireUser } from '@/lib/session'
import { ProfileEditor } from '@/components/ProfileEditor'
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const user = await requireUser(),
    { id } = await params
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
  if (!row) notFound()
  return (
    <div className="profile-editor">
      <Link href="/profiles" className="back-link">
        <ArrowLeft size={16} /> My profile
      </Link>
      <div className="page-heading">
        <div>
          <div className="eyebrow">MAKE IT YOURS</div>
          <h1>
            {row.reviewedAt
              ? 'Your application profile.'
              : 'Does this look like you?'}
          </h1>
          <p>Check your details and fill in anything we missed.</p>
        </div>
        <a
          href={`/api/resumes/${id}`}
          target="_blank"
          rel="noreferrer"
          className="button secondary"
        >
          <Download size={16} />
          View PDF
        </a>
      </div>
      <ProfileEditor
        id={id}
        data={row.data}
        name={row.name}
        reviewed={!!row.reviewedAt}
      />
    </div>
  )
}
