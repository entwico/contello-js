/** What an operation is rejected with when it got no answer within `operationTimeoutMs`. */
export class ContelloTimeoutError extends Error {
  override name = 'ContelloTimeoutError';

  constructor(timeoutMs: number) {
    super(`@contello/client: the operation got no answer within ${timeoutMs} ms`);
  }
}

/** What every operation takes last. */
export type OperationOptions = {
  /**
   * Ends the operation and rejects it with the reason of the signal. A call with a signal is not
   * given the `operationTimeoutMs` of the client on top.
   */
  signal?: AbortSignal | undefined;
};

export type Deadline = {
  signal: AbortSignal | undefined;
  /** Starts the wait over: an operation that still receives is not late. */
  restart(): void;
  clear(): void;
};

/**
 * When an operation has to end: on the signal of its caller, or, without one, when the timeout of
 * the client ran out. The time an operation waits for a connection counts.
 */
export function createDeadline(signal: AbortSignal | undefined, timeoutMs: number | undefined): Deadline {
  if (signal || timeoutMs === undefined) {
    return { signal, restart() {}, clear() {} };
  }

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const restart = () => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(new ContelloTimeoutError(timeoutMs)), timeoutMs);
    timer.unref?.();
  };

  restart();

  return { signal: controller.signal, restart, clear: () => clearTimeout(timer) };
}
