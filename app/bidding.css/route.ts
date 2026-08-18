import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { prototypeFile } from '@/lib/prototype-file'

export async function GET() {
  const file = await readFile(join(process.cwd(), 'bidding.css'))
  return prototypeFile(file, 'text/css; charset=utf-8')
}
