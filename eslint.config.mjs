import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTypescript from 'eslint-config-next/typescript'

/** Next.js's recommended rules (React, hooks, accessibility basics, TypeScript). */
export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  globalIgnores(['.next/', 'next-env.d.ts']),
  {
    rules: {
      // `const { secret: _secret, ...rest } = value` is how this code omits a key.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      // <img> is used for brand SVGs in public/ (nothing to optimise) and for
      // company logos from arbitrary hosts, which next/image would require
      // allow-listing one by one in next.config.mjs.
      '@next/next/no-img-element': 'off',
    },
  },
])
