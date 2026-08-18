import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { prototypeFile } from '@/lib/prototype-file'

export async function GET() {
  const file = await readFile(join(process.cwd(), 'bidding.html'))
  return prototypeFile(file, 'text/html; charset=utf-8')
}
