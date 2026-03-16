import dc from 'node:diagnostics_channel';

// ---------------------------------------------------------------------------
// channel names (exported for subscribers)
// ---------------------------------------------------------------------------

export const channels = {
  start: 'contello:sdk.start',
  end: 'contello:sdk.end',
  error: 'contello:sdk.error',
  /** subscribe to decorate outgoing GraphQL WebSocket messages (e.g. inject traceparent) */
  message: 'contello:sdk.message',
} as const;

// ---------------------------------------------------------------------------
// message types (exported for subscribers)
// ---------------------------------------------------------------------------

export type OperationStartMessage = {
  name: string;
};

export type OperationEndMessage = {
  name: string;
  durationMs: number;
};

export type OperationErrorMessage = {
  name: string;
  error: unknown;
  durationMs: number;
};

export type MessageDecorateMessage = {
  message: any;
};

// ---------------------------------------------------------------------------
// internal channels
// ---------------------------------------------------------------------------

const onStart = dc.channel(channels.start);
const onEnd = dc.channel(channels.end);
const onError = dc.channel(channels.error);
const onMessage = dc.channel(channels.message);

function hasOperationSubscribers(): boolean {
  return onStart.hasSubscribers || onEnd.hasSubscribers || onError.hasSubscribers;
}

// ---------------------------------------------------------------------------
// wrap — used by client.ts for sdk:execute
// ---------------------------------------------------------------------------

export function getWrap(): (<T>(name: string, fn: () => T) => T) | undefined {
  if (!hasOperationSubscribers()) {
    return undefined;
  }

  return <T>(name: string, fn: () => T): T => {
    const start = performance.now();

    onStart.publish({ name } satisfies OperationStartMessage);

    let result: T;

    try {
      result = fn();
    } catch (error) {
      onError.publish({ name, error, durationMs: performance.now() - start } satisfies OperationErrorMessage);

      throw error;
    }

    if (result instanceof Promise) {
      return result.then(
        (r) => {
          onEnd.publish({ name, durationMs: performance.now() - start } satisfies OperationEndMessage);

          return r;
        },
        (error) => {
          onError.publish({ name, error, durationMs: performance.now() - start } satisfies OperationErrorMessage);

          throw error;
        },
      ) as T;
    }

    onEnd.publish({ name, durationMs: performance.now() - start } satisfies OperationEndMessage);

    return result;
  };
}

// ---------------------------------------------------------------------------
// message decorator — used by client.ts for WebSocket message enrichment
// ---------------------------------------------------------------------------

export function decorateMessage(message: any): any {
  if (!onMessage.hasSubscribers) {
    return message;
  }

  const msg: MessageDecorateMessage = { message };

  onMessage.publish(msg);

  return msg.message;
}
