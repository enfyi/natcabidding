import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { prototypeFile } from '@/lib/prototype-file'

export const dynamic = 'force-static'

const filePromise = readFile(join(process.cwd(), 'bidding.html'))

export async function GET() {
  const file = await filePromise
  return prototypeFile(file, 'text/html; charset=utf-8')
}
