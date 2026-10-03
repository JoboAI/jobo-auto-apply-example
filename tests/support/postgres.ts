import { Client } from 'pg'

/** A server login that may CREATE DATABASE. Defaults to `npm run db:up`. */
export function adminUrl() {
  return process.env.TEST_DATABASE_URL ?? 'postgres://auto_apply:auto_apply@127.0.0.1:5433/postgres'
}

export function databaseUrl(name: string) {
  const url = new URL(adminUrl())
  url.pathname = `/${name}`
  return url.toString()
}

export async function admin<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: adminUrl() })
  try {
    await client.connect()
  } catch (error) {
    throw new Error(
      `Postgres is not reachable at ${adminUrl()}. Run \`npm run db:up\`, or set TEST_DATABASE_URL. (${String(error)})`,
    )
  }
  try {
    return await run(client)
  } finally {
    await client.end()
  }
}

export async function createDatabase(name: string, template?: string) {
  await admin((client) =>
    client.query(`create database "${name}"${template ? ` template "${template}"` : ''}`),
  )
}

export async function dropDatabase(name: string) {
  await admin((client) => client.query(`drop database if exists "${name}" with (force)`))
}
