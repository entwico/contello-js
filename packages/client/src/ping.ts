const PING_QUERY = `query ContelloPing { contelloPing { response } }`;

type PingResult = { contelloPing: { response: string } };

export async function ping(execute: <T>(query: string) => Promise<T>): Promise<void> {
  const data = await execute<PingResult>(PING_QUERY);

  if (data.contelloPing.response !== 'pong') {
    throw new Error(`unexpected ping response: ${data.contelloPing.response}`);
  }
}
