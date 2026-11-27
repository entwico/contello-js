import type { ContelloClient } from '@contello/client';

/**
 * Reads everything a source subscription streams. A read whose connection was lost starts over
 * inside the client, so the answer holds every entity once.
 */
export async function collectSource<T>(
  client: ContelloClient<any>,
  document: string,
  variables: Record<string, unknown>,
): Promise<T[]> {
  const batches = await client.collect<{ source: T[] }>(document, variables);

  return batches.flatMap((batch) => batch.source);
}
