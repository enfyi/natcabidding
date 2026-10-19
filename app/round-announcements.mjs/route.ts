import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { prototypeFile } from '@/lib/prototype-file'

export const dynamic = 'force-static'
const filePromise = readFile(join(process.cwd(), 'round-announcements.mjs'))
export async function GET() {
  return prototypeFile(await filePromise, 'text/javascript; charset=utf-8')
}
