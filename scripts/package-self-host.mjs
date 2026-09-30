import { cpSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const standalone = join(root, '.next', 'standalone')
const outputDir = join(root, 'outputs')
const archive = join(outputDir, 'zla-bidding-self-host.tgz')

mkdirSync(join(standalone, '.next'), { recursive: true })
mkdirSync(outputDir, { recursive: true })

cpSync(join(root, 'public'), join(standalone, 'public'), { recursive: true })
cpSync(join(root, '.next', 'static'), join(standalone, '.next', 'static'), { recursive: true })

rmSync(archive, { force: true })
execFileSync('tar', ['-czf', archive, '-C', standalone, '.'], { stdio: 'inherit' })

console.log(`Created ${archive}`)
