import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FlatCompat } from '@eslint/eslintrc'

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) })

/** Next.js's recommended rules (React, hooks, accessibility basics, TypeScript). */
const config = [
  { ignores: ['.next/', 'node_modules/', 'next-env.d.ts'] },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      // `const { secret: _secret, ...rest } = value` is how this code omits a key.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      // <img> is used for brand SVGs in public/ (nothing to optimise) and for
      // company logos from arbitrary hosts, which next/image would require
      // allow-listing one by one in next.config.ts.
      '@next/next/no-img-element': 'off',
    },
  },
]

export default config
