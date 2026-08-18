import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { prototypeFile } from '@/lib/prototype-file'

export async function GET() {
  const file = await readFile(join(process.cwd(), 'supabase-config.js'))
  return prototypeFile(file, 'text/javascript; charset=utf-8')
}
