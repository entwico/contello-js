import dc from 'node:diagnostics_channel';

// ---------------------------------------------------------------------------
// channel names (exported for subscribers)
// ---------------------------------------------------------------------------

export const channels = {
  start: 'contello:store.start',
  end: 'contello:store.end',
  error: 'contello:store.error',
} as const;

// ---------------------------------------------------------------------------
// message types (exported for subscribers)
// ---------------------------------------------------------------------------

export type OperationStartMessage = {
  name: string;
};

export type OperationEndMessage = {
  name: string;
  cached: boolean;
  durationMs: number;
};

export type OperationErrorMessage = {
  name: string;
  error: unknown;
  durationMs: number;
};

// ---------------------------------------------------------------------------
// internal channels
// ---------------------------------------------------------------------------

const onStart = dc.channel(channels.start);
const onEnd = dc.channel(channels.end);
const onError = dc.channel(channels.error);

function hasSubscribers(): boolean {
  return onStart.hasSubscribers || onEnd.hasSubscribers || onError.hasSubscribers;
}

// ---------------------------------------------------------------------------
// wrap — internal, not exported from hooks entry point
// ---------------------------------------------------------------------------

export function wrap<T>(name: string, fn: () => T): T {
  if (!hasSubscribers()) {
    return fn();
  }

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
        onEnd.publish({ name, cached: false, durationMs: performance.now() - start } satisfies OperationEndMessage);

        return r;
      },
      (error) => {
        onError.publish({ name, error, durationMs: performance.now() - start } satisfies OperationErrorMessage);

        throw error;
      },
    ) as T;
  }

  onEnd.publish({ name, cached: true, durationMs: performance.now() - start } satisfies OperationEndMessage);

  return result;
}
