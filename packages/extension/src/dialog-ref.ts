import type { ExtensionChannel } from './channel';
import type { Deferred } from './utils';

export interface ContelloDialogParams<D, T> {
  channel: ExtensionChannel<any, any>;
  options: ContelloDialogOptions<D>;
  controller: {
    connected: Deferred<void>;
    ready: Deferred<void>;
    complete: Deferred<T>;
    close: () => void;
  };
}

export interface ContelloDialogOptions<D> {
  url: string;
  width?: number;
  data?: D;
}

export class ContelloDialogRef<D, T> {
  private _id?: string;
  readonly open: Promise<void>;
  readonly connected: Promise<void>;
  readonly ready: Promise<void>;
  readonly complete: Promise<T>;
  readonly close: () => void;

  constructor({ channel, options, controller }: ContelloDialogParams<D, T>) {
    this.open = channel.call('openDialog', options).then(({ id }) => (this._id = id));
    this.connected = controller.connected.promise;
    this.ready = controller.ready.promise;
    this.complete = controller.complete.promise;
    this.close = controller.close;
  }

  get id() {
    return this._id;
  }
}
