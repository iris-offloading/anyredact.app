/** Runs `task` for every index below `n`, at most `limit` at a time. The first failure stops new tasks and rejects. */
export async function pool(n: number, limit: number, task: (i: number) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < n) {
      const i = next++;
      try {
        await task(i);
      } catch (err) {
        next = n;
        throw err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, n) }, worker));
}
