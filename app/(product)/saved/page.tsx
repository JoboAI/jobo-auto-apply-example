import { FeedPage, type FeedSearch } from '@/lib/feed-page'
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<FeedSearch>
}) {
  return <FeedPage savedOnly search={await searchParams} />
}
