import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export const dynamic = 'force-static'

const filePromise = readFile(
  join(process.cwd(), 'node_modules/@supabase/supabase-js/dist/umd/supabase.js'),
)

export async function GET() {
  const file = await filePromise
  return new Response(new Uint8Array(file), {
    headers: {
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Content-Type': 'text/javascript; charset=utf-8',
    },
  })
}
