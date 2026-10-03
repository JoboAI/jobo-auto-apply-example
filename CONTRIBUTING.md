# Contributing

Thanks for helping improve the example.

## Where changes happen

This repository is a one-way mirror of `Jobo.Examples/auto-apply` in Jobo's
main (private) repository. It is overwritten on every sync, so pull requests
here cannot be merged. Instead:

- **Bugs and suggestions:** open an [issue](https://github.com/JoboAI/jobo-auto-apply-example/issues)
  with steps to reproduce, what you expected, and what happened. Logs from the
  web app and the worker help (redact keys first).
- **Security problems:** do not open an issue. See [SECURITY.md](SECURITY.md).
- **Questions about the Auto Apply API itself:** see the
  [API docs](https://jobo.world/docs/api-reference/auto-apply/auto-apply), or
  contact Jobo support.

If you propose a code change in an issue, a diff or a link to your fork's
branch is very welcome. We will port it upstream and credit you.

## Working on your fork

```sh
npm ci
npm run db:up
npm run check      # lint, formatting, types, tests
```

Conventions the codebase follows:

- Server code reads configuration only through `lib/config.ts`.
- Client components import types, not values, from server modules. The test
  `tests/client-boundary.test.ts` enforces this.
- Every server action validates its own arguments and checks ownership.
- Schema changes go through `npm run db:generate` (Drizzle), never hand-edited
  migrations.
- Comments explain *why*. The Auto Apply contract is non-obvious in places
  (blocking calls, idempotency, free validation); say so where you rely on it.
