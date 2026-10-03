import { redirect } from 'next/navigation'

type HomePageProps = {
  searchParams: Promise<{ page?: string; area?: string; section?: string }>
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const values = await searchParams
  const params = new URLSearchParams()
  for (const key of ['page', 'area', 'section'] as const) {
    if (typeof values[key] === 'string') params.set(key, values[key])
  }
  redirect(`/bidding.html${params.size ? `?${params}` : ''}`)
}
