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

/**
 * Reads the one entity a singleton subscription answers with. Like the list reads it is sent again
 * when its connection is lost, and it ends with the `operationTimeoutMs` of the client.
 */
export async function readSingleton<T>(client: ContelloClient<any>, document: string): Promise<T> {
  const response = await client.execute<{ source: T }>(document, undefined, { retry: true });

  return response.source;
}
