import Link from 'next/link'
import { redirect } from 'next/navigation'
import { desc } from 'drizzle-orm'
import { db } from '@/db/client'
import { applications, profiles } from '@/db/schema'
import { callbackUrl, config } from '@/lib/config'
import { getSandboxScenarios } from '@/lib/jobo/client'
import type { SandboxScenario } from '@/lib/jobo/sandbox'
import { envRegressed, getTutorialState, TUTORIAL_STEPS } from '@/lib/tutorial'
import { ApplyForm } from '@/components/ApplyForm'
import { Badge, ButtonLink, Panel, StatusBadge, relativeTime } from '@/components/ui'

export const dynamic = 'force-dynamic'

/**
 * The front door routes on tutorial state:
 *
 *   incomplete → the current tutorial step (the app IS the tutorial until
 *                you have seen the whole contract execute once)
 *   complete   → the workbench: create another application in zero clicks,
 *                with the reference surfaces one link away
 */
export default async function HomePage() {
  const state = getTutorialState()

  if (!state.complete) {
    redirect(`/learn/${TUTORIAL_STEPS[state.currentStep - 1].slug}`)
  }

  const profileRows = db.select().from(profiles).orderBy(desc(profiles.createdAt)).all()
  const recent = db.select().from(applications).orderBy(desc(applications.createdAt)).limit(8).all()

  let scenarios: SandboxScenario[] = []
  let sandboxAvailable = false
  let sandboxNote: string | null = null
  try {
    const response = await getSandboxScenarios()
    sandboxAvailable = response.available
    scenarios = response.scenarios.filter((scenario) => scenario.apply_url)
    if (!response.available) sandboxNote = 'the sandbox is not enabled on this deployment yet'
  } catch (error) {
    sandboxNote = `could not load scenarios (${error instanceof Error ? error.message : String(error)})`
  }

  return (
    <div className="space-y-8">
      <header className="border-b hairline pb-6">
        <p className="eyebrow">Workbench</p>
        <h1 className="mt-1 font-display text-3xl font-medium text-ink-900">Auto Apply</h1>
        <p className="mt-2 text-sm text-ink-600">
          Tutorial complete —{' '}
          <Link
            href="/learn/connect"
            className="font-medium text-brand hover:text-brand-deep hover:underline"
          >
            revisit any step
          </Link>{' '}
          whenever you need the walkthrough again.
        </p>
      </header>

      {/* Reappears exactly when the state that gated the tutorial regresses —
          most commonly a quick-tunnel hostname that changed on restart. */}
      {envRegressed() && (
        <div className="bg-warning-tint px-4 py-3 text-sm text-warning-deep">
          Environment values are missing or invalid — callbacks will not arrive.{' '}
          <Link href="/learn/connect" className="font-medium underline">
            Check your setup
          </Link>
          .
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <Panel title="New application">
            <ApplyForm
              profiles={profileRows.map((p) => ({ id: p.id, name: p.name, isDefault: p.isDefault }))}
              scenarios={scenarios}
              sandboxAvailable={sandboxAvailable && scenarios.length > 0}
              sandboxNote={sandboxNote}
              defaultSandbox={config().DEFAULT_SANDBOX}
              callbackUrl={callbackUrl()}
            />
          </Panel>
        </div>

        <div className="space-y-6 lg:col-span-2">
          <Panel
            title="Profiles"
            actions={
              <Link href="/profiles" className="text-xs font-medium text-brand hover:text-brand-deep hover:underline">
                Manage
              </Link>
            }
          >
            {profileRows.length === 0 ? (
              <p className="text-sm text-ink-600">Profiles not added yet.</p>
            ) : (
              <ul className="divide-y hairline text-sm">
                {profileRows.slice(0, 4).map((profile) => (
                  <li key={profile.id} className="flex items-center justify-between gap-3 py-2">
                    <Link href={`/profiles/${profile.id}`} className="truncate text-ink-800 hover:underline">
                      {profile.name}
                    </Link>
                    {profile.isDefault && <Badge tone="info">default</Badge>}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      <Panel
        title="Recent applications"
        padding="none"
        actions={
          <Link href="/applications" className="text-xs font-medium text-brand hover:text-brand-deep hover:underline">
            View all
          </Link>
        }
      >
        {recent.length === 0 ? (
          <p className="p-6 text-sm text-ink-600">Applications not created yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="s-table">
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>URL</th>
                  <th>Status</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((application) => (
                  <tr key={application.id}>
                    <td>
                      <Link
                        href={`/applications/${application.id}`}
                        className="font-medium text-ink-900 hover:underline"
                      >
                        {application.providerName || 'Unmatched'}
                      </Link>
                      {application.sandbox && (
                        <span className="ml-2">
                          <Badge>sandbox</Badge>
                        </span>
                      )}
                    </td>
                    <td className="max-w-64 truncate text-ink-600">{application.applyUrl}</td>
                    <td>
                      <StatusBadge status={application.status} />
                    </td>
                    <td className="text-ink-600">{relativeTime(application.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {profileRows.length === 0 && (
        <div className="flex justify-end">
          <ButtonLink href="/profiles" variant="secondary" size="sm">
            Import a resume
          </ButtonLink>
        </div>
      )}
    </div>
  )
}
