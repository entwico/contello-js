import type { ContelloSdkClient } from '@contello/sdk-client';

import PING_QUERY from '../graphql/ping.gql';
import { wrap } from './diagnostics';
import type { StorePingQuery } from './generated/graphql';

export function createPing(client: ContelloSdkClient<unknown>): () => Promise<void> {
  return () =>
    wrap('store:ping', () =>
      client.execute<StorePingQuery>(PING_QUERY).then((data) => {
        if (data.contelloPing.response !== 'pong') {
          throw new Error(`unexpected ping response: ${data.contelloPing.response}`);
        }
      }),
    );
}
