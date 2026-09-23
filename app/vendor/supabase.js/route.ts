import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export async function GET() {
  const file = await readFile(
    join(process.cwd(), 'node_modules/@supabase/supabase-js/dist/umd/supabase.js'),
  )

  return new Response(new Uint8Array(file), {
    headers: {
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Content-Type': 'text/javascript; charset=utf-8',
    },
  })
}
