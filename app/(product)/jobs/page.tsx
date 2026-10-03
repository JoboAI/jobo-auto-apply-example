import type { Metadata } from 'next'
import { FeedPage, type FeedSearch } from '@/lib/feed-page'

export const metadata: Metadata = { title: 'Jobs' }
export default async function Page({ searchParams }: { searchParams: Promise<FeedSearch> }) {
  return <FeedPage search={await searchParams} />
}
