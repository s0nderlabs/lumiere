// Bounded-concurrency map. Walks items in order, never running more than
// `limit` worker promises at a time. Returns results in the same order as
// `items`. Preserves rejected promises so callers see the original failure.
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return []
  const cap = Math.max(1, Math.min(limit, items.length))
  const results = new Array<R>(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: cap }, async () => {
      while (true) {
        const i = next++
        if (i >= items.length) return
        results[i] = await worker(items[i], i)
      }
    }),
  )
  return results
}
