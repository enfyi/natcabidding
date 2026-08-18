import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { notFound } from 'next/navigation'
import { prototypeFile } from '@/lib/prototype-file'

type AssetRouteProps = {
  params: Promise<{ filename: string }>
}

export async function GET(_request: Request, { params }: AssetRouteProps) {
  const { filename } = await params

  if (filename !== 'logo-5v2a.png') {
    notFound()
  }

  const file = await readFile(join(process.cwd(), 'assets', 'logo-5v2a.png'))
  return prototypeFile(file, 'image/png')
}
