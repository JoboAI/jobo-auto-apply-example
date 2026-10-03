/**
 * Load .env.local (and the other .env files) the way `next dev` does, for the
 * scripts that run outside Next: the worker, migrations, doctor and health
 * probe. Variables already set in the environment win, so a container or
 * service manager that injects them is unaffected.
 *
 * Import it first: `import './load-env'`.
 */
// CommonJS package: a named ESM import of loadEnvConfig fails at runtime.
import nextEnv from '@next/env'

nextEnv.loadEnvConfig(process.cwd(), false, { info: () => {}, error: console.error })
