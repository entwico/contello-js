import type { ContelloMethods } from './methods';
import type { ExtensionEvent, ExtensionEventPayload } from './types';

export type Handler<REQ, RES> = (msg: REQ) => RES | Promise<RES>;

let channelIdIterator = 0;
let requestIdIterator = 0;

export class ExtensionChannel<OWN extends ContelloMethods, REMOTE extends ContelloMethods> {
  handlers = new Map();
  listeners = new Map<string, Handler<any, any>>();

  private targetWindow!: Window;
  private channelId!: string;
  private targetOrigin!: string;
  private isParent!: boolean;

  constructor(private params: { debug: boolean }) {}

  populateChannelId() {
    if (!this.channelId) {
      this.channelId = this.createChannelId();
    }

    return this.channelId;
  }

  connectParent(targetOrigin: string, channelId: string) {
    this.channelId = channelId;
    this.targetOrigin = targetOrigin;
    this.targetWindow = window.parent;
    this.isParent = false;
    this.connect();
  }

  connectChild(targetWindow: Window) {
    this.populateChannelId();
    this.targetWindow = targetWindow;
    this.targetOrigin = '*';
    this.isParent = true;
    this.connect();
  }

  getChannelId() {
    return this.channelId;
  }

  getIsDebug() {
    return this.params.debug;
  }

  getTargetOrigin() {
    return this.targetOrigin;
  }

  getTargetWindow() {
    return this.targetWindow;
  }

  private connect() {
    window.addEventListener('message', this.handler);
  }

  disconnect() {
    window.removeEventListener('message', this.handler);
  }

  private handler = (event: MessageEvent) => {
    if (event.data.channelId !== this.channelId) {
      return;
    }

    if (this.targetOrigin === '*' || event.origin === this.targetOrigin) {
      const { channelId: requestChannelId, requestId, method } = event.data;

      if (requestChannelId === this.channelId) {
        if (this.params.debug) {
          console.log(this.isParent ? 'Parent received' : 'Child received', event.data);
        }

        if (this.handlers.has(requestId)) {
          this.handlers.get(requestId)(event.data);
        } else if (this.listeners.has(method)) {
          Promise.resolve(this.listeners.get(method)?.(event.data.payload))
            .then((responsePayload: any) => this.respond(event.data, responsePayload))
            .catch((err) => this.respondError(event.data, err));
        }
      }
    }
  };

  respond(request: ExtensionEvent, payload: ExtensionEventPayload) {
    this.send({ channelId: request.channelId, requestId: request.requestId, method: request.method, payload });
  }

  respondError(request: ExtensionEvent, error: any) {
    this.send({ channelId: request.channelId, requestId: request.requestId, method: request.method, error });
  }

  on<M extends keyof OWN>(method: M, handler: Handler<OWN[M][0], OWN[M][1]>): void {
    this.listeners.set(method as string, handler);
  }

  call<M extends keyof REMOTE>(method: M, message?: REMOTE[M][0]): Promise<REMOTE[M][1]> {
    return new Promise<any>((resolve, reject) => {
      const requestId = this.createRequestId();

      this.send({ channelId: this.channelId, requestId, method: method as string, payload: message as any });

      this.handlers.set(requestId, (data: ExtensionEvent) => {
        this.handlers.delete(requestId);

        if (data.error) {
          return reject(data.error);
        }

        resolve(data.payload);
      });
    });
  }

  send(data: ExtensionEvent) {
    this.targetWindow?.postMessage(data, this.targetOrigin);
  }

  private createChannelId() {
    return `contello-channel-${++channelIdIterator}-${Math.random().toString(36).substring(2)}`;
  }
  private createRequestId() {
    return `${this.isParent ? 'parent' : 'child'}-request-${++requestIdIterator}-${Math.random()
      .toString(36)
      .substring(2)}`;
  }
}
