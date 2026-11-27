import type { ExtensionEvent } from './types';

type Listener = (event: MessageEvent) => void;
type Answer = (payload: any) => unknown;
type MessageOrigin = { source?: unknown; origin?: string | undefined };

export type FakeHost = {
  readonly origin: string;
  readonly channelId: string;
  /** the window the Contello ui lives in: `window.parent` of the extension page */
  readonly window: Window;
  /** every request the extension page sent, in order */
  readonly requests: ExtensionEvent[];
  /** the target origin of every message the extension page posted */
  readonly targetOrigins: string[];
  /** how many `message` listeners the extension page holds on its window */
  listeners(): number;
  /** what the host answers a request of the extension page with; a throw answers with an error */
  answer(method: string, answer: Answer): void;
  /** a request of the host to the extension page, settled by its answer */
  call(method: string, payload?: unknown): Promise<any>;
  /** a raw message to the extension page, from the host unless `from` says otherwise */
  deliver(data: Partial<ExtensionEvent>, from?: MessageOrigin | undefined): void;
  payloads(method: string): unknown[];
};

/**
 * The Contello ui side of an extension page, for a node test: stubs `window` and `location` through
 * `stubGlobal` (vitest's `vi.stubGlobal`) so that the page under test finds a parent window that
 * records its requests and answers them.
 */
export function createFakeHost(
  stubGlobal: (name: string, value: unknown) => unknown,
  options?: { debug?: boolean | undefined } | undefined,
): FakeHost {
  const origin = 'https://contello.example.com';
  const channelId = 'channel-1';
  const listeners = new Set<Listener>();
  const answers = new Map<string, Answer>();
  const pending = new Map<string, { resolve: (value: unknown) => void; reject: (reason: unknown) => void }>();
  const requests: ExtensionEvent[] = [];
  const targetOrigins: string[] = [];
  let hostRequests = 0;

  function deliver(data: Partial<ExtensionEvent>, from?: MessageOrigin | undefined): void {
    const event = { data, source: from?.source ?? hostWindow, origin: from?.origin ?? origin } as MessageEvent;

    for (const listener of listeners) {
      listener(event);
    }
  }

  function answerRequest(request: ExtensionEvent): void {
    const answer = answers.get(request.method);

    if (!answer) {
      return;
    }

    const base = { channelId: request.channelId, requestId: request.requestId, method: request.method };

    queueMicrotask(() => {
      try {
        deliver({ ...base, payload: answer(request.payload) as object });
      } catch (error) {
        deliver({ ...base, error: (error as Error).message });
      }
    });
  }

  const hostWindow = {
    postMessage(data: ExtensionEvent, targetOrigin: string) {
      targetOrigins.push(targetOrigin);

      const reply = pending.get(data.requestId);

      if (!reply) {
        requests.push(data);
        answerRequest(data);

        return;
      }

      pending.delete(data.requestId);

      if (data.error === undefined) {
        reply.resolve(data.payload);
      } else {
        reply.reject(data.error);
      }
    },
  } as unknown as Window;

  const query = new URLSearchParams({ channelId, origin, applicationId: 'project-1' });

  if (options?.debug) {
    query.set('debug', 'true');
  }

  stubGlobal('location', { href: `https://extension.example.com/?${query.toString()}` });
  stubGlobal('window', {
    parent: hostWindow,
    addEventListener: (_type: string, listener: Listener) => listeners.add(listener),
    removeEventListener: (_type: string, listener: Listener) => listeners.delete(listener),
  });

  return {
    origin,
    channelId,
    window: hostWindow,
    requests,
    targetOrigins,
    listeners: () => listeners.size,
    answer: (method, answer) => void answers.set(method, answer),
    call(method, payload) {
      const requestId = `host-request-${++hostRequests}`;

      return new Promise((resolve, reject) => {
        pending.set(requestId, { resolve, reject });
        deliver({ channelId, requestId, method, payload: payload as object });
      });
    },
    deliver,
    payloads: (method) => requests.filter((request) => request.method === method).map((request) => request.payload),
  };
}
