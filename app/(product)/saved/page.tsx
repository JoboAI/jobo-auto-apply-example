import type { Metadata } from 'next'
import { FeedPage, type FeedSearch } from '@/lib/feed-page'

export const metadata: Metadata = { title: 'Saved jobs' }
export default async function Page({ searchParams }: { searchParams: Promise<FeedSearch> }) {
  return <FeedPage savedOnly search={await searchParams} />
}
