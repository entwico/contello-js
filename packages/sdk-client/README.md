# @contello/sdk-client

GraphQL SDK client for Contello CMS with WebSocket transport and connection pooling.

## Installation

```bash
npm install @contello/sdk-client rxjs graphql graphql-ws
```

## Usage

### Basic setup

```ts
import { ContelloSdkClient } from '@contello/sdk-client';
import { getSdk } from './generated-sdk';

const client = new ContelloSdkClient(getSdk, {
  url: 'https://example.com',
  project: 'myProjectId',
  token: 'app-a123b456c7890d123456789',
});

await client.connect();

const result = await client.sdk.someQuery({ id: '123' });
```

### Connection pooling

By default, the client maintains a pool of 5 WebSocket connections and round-robins requests across them.

```ts
const client = new ContelloSdkClient(getSdk, {
  url: 'https://example.com',
  project: 'myProjectId',
  token: 'token',
  pooling: {
    size: 10,
  },
});
```

To disable pooling:

```ts
pooling: {
  enabled: false;
}
```

### Middleware

Middlewares can intercept requests and outgoing WebSocket messages.

```ts
import type { ContelloSdkClientMiddleware } from '@contello/sdk-client';

const loggingMiddleware: ContelloSdkClientMiddleware = {
  onRequest(request, next) {
    console.log(`${request.kind}: ${request.operationName}`);

    return next();
  },
};

const client = new ContelloSdkClient(getSdk, {
  url: 'https://example.com',
  project: 'myProjectId',
  token: 'token',
  middlewares: [loggingMiddleware],
});
```

### Client events

```ts
const client = new ContelloSdkClient(getSdk, {
  url: 'https://example.com',
  project: 'myProjectId',
  token: 'token',
  client: {
    retryAttempts: 5,
    onConnected: (ctx) => console.log(`connected: ${ctx.connectionId}`),
    onError: (ctx, error) => console.error(`error on ${ctx.connectionId}:`, error),
    onClosed: (ctx) => console.log(`closed: ${ctx.connectionId}`),
  },
});
```

### Disconnect

```ts
await client.disconnect();
```

> `connect()` resolves once all WebSocket connections in the pool have been acknowledged by the server. The underlying transport retries automatically on transient failures, so the promise will stay pending until every connection succeeds. If retries are exhausted the promise will remain unresolved.

## API

### `ContelloSdkClient`

| Option                 | Type                            | Default | Description                          |
| ---------------------- | ------------------------------- | ------- | ------------------------------------ |
| `url`                  | `string`                        | —       | Base URL of the Contello server      |
| `project`              | `string`                        | —       | Project identifier                   |
| `token`                | `string`                        | —       | Authentication token                 |
| `middlewares`          | `ContelloSdkClientMiddleware[]` | `[]`    | Request/message middlewares          |
| `pooling.enabled`      | `boolean`                       | `true`  | Enable connection pooling            |
| `pooling.size`         | `number`                        | `5`     | Number of WebSocket connections      |
| `client.retryAttempts` | `number`                        | `3`     | Retry attempts on connection failure |

### Methods

| Method         | Returns         | Description                |
| -------------- | --------------- | -------------------------- |
| `sdk`          | `T`             | The generated SDK instance |
| `connect()`    | `Promise<void>` | Open WebSocket connections |
| `disconnect()` | `Promise<void>` | Close all connections      |

## License

MIT
