import Link from 'next/link'
import type { TutorialState } from '@/lib/tutorial'

/**
 * The tutorial stepper — a port of the portal's Stepper.vue.
 *
 * Visual contract: the current step is a purple-filled circle, completed steps
 * are ink-900 with a check, upcoming steps are white with a hairline border.
 * The circles are the one sanctioned use of rounded-full. Steps up to
 * `highestAvailableStep` render as links; locked steps are inert.
 */

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="h-3.5 w-3.5">
      <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function Stepper({ state }: { state: TutorialState }) {
  return (
    <nav aria-label="Tutorial progress">
      <ol className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-0">
        {state.steps.map((step, index) => {
          const position = index + 1
          const isCurrent = position === state.currentStep
          const isComplete = step.done
          const isNavigable = position <= state.highestAvailableStep && !isCurrent

          const circle = isCurrent
            ? 'border-brand bg-brand text-white'
            : isComplete
              ? 'border-ink-900 bg-ink-900 text-white'
              : 'border-ink-200 bg-white text-ink-600'

          const content = (
            <span className="inline-flex min-w-0 items-center gap-2.5 py-1 text-left">
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-medium tabular-nums transition-colors duration-150 ease-out ${circle}`}
              >
                {isComplete && !isCurrent ? <CheckIcon /> : position}
              </span>
              <span className="min-w-0">
                <span
                  className={`block text-sm font-medium ${
                    isCurrent || isComplete ? 'text-ink-800' : 'text-ink-600'
                  }`}
                >
                  {step.label}
                </span>
                <span className="mt-0.5 hidden text-xs text-ink-600 lg:block">
                  {step.description}
                </span>
              </span>
            </span>
          )

          return (
            <li key={step.slug} className="flex min-w-0 items-center">
              {isNavigable ? (
                <Link href={`/learn/${step.slug}`} className="min-w-0">
                  {content}
                </Link>
              ) : (
                <span className="min-w-0" aria-current={isCurrent ? 'step' : undefined}>
                  {content}
                </span>
              )}
              {index < state.steps.length - 1 && (
                <span className="mx-4 hidden h-px w-10 shrink-0 bg-ink-200 sm:block" aria-hidden />
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
