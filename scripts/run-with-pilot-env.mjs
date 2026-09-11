import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const command = process.argv[2]

if (!['dev', 'build'].includes(command)) {
  throw new Error('Usage: node scripts/run-with-pilot-env.mjs <dev|build>')
}

const pilotEnv = { ...process.env }

for (const sourceLine of readFileSync('.env.pilot.local', 'utf8').split(/\r?\n/)) {
  const line = sourceLine.trim()
  if (!line || line.startsWith('#')) continue

  const separator = line.indexOf('=')
  if (separator < 1) continue

  const key = line.slice(0, separator).trim()
  const value = line.slice(separator + 1).trim().replace(/^(["'])(.*)\1$/, '$2')
  pilotEnv[key] = value
}

const result = spawnSync(
  process.execPath,
  ['node_modules/next/dist/bin/next', command],
  { env: pilotEnv, stdio: 'inherit' },
)

if (result.error) throw result.error
process.exit(result.status ?? 1)
