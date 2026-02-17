import { ExtensionChannel } from './channel';
import { type ContelloDialogOptions, ContelloDialogRef } from './dialog-ref';
import type { ContelloClientChildMethods, ContelloClientParentMethods } from './methods';
import { Deferred } from './utils';

type ContelloEntityDetailParams = { mode: 'create' } | { mode: 'edit'; id: string } | { mode: 'clone'; id: string };

export class ContelloClient<D, O extends ContelloClientChildMethods, R extends ContelloClientParentMethods> {
  protected channel: ExtensionChannel<O, R>;
  protected projectId: string;
  private resizeObserver?: ResizeObserver;

  private targetOrigin: string;

  data?: D;

  private dialogs = new Map<
    ContelloDialogRef<any, any>,
    {
      connected: Deferred<void>;
      ready: Deferred<void>;
      complete: Deferred<any>;
    }
  >();

  constructor(targetOrigin: string, channelId: string, projectId: string, debug: boolean) {
    this.channel = new ExtensionChannel({ debug });
    this.channel.connectParent(targetOrigin, channelId);
    this.projectId = projectId;
    this.targetOrigin = targetOrigin;
  }

  connect() {
    return this.channel.call('connect').then(({ data }) => {
      this.channel.on('dialogConnect', ({ id }) => this.getDialogController(id)?.connected.resolve());
      this.channel.on('dialogReady', ({ id }) => this.getDialogController(id)?.ready.resolve());
      this.channel.on('dialogComplete', ({ id, value }) => this.getDialogController(id)?.complete.resolve(value));

      this.data = data;
    });
  }

  ready() {
    this.listenForResize();

    return this.channel.call('ready', { height: this.getWindowHeight() });
  }

  getAuthToken(): Promise<string> {
    return this.channel.call('getAuthToken').then(({ token }) => token);
  }

  createProjectUrl() {
    return `${this.targetOrigin}/ui/projects/${this.projectId}`;
  }

  private createEntityEntryUrl(referenceName: string): string {
    return `${this.createProjectUrl()}/entities/${referenceName}`;
  }

  createSingletonEntityUrl(referenceName: string): string {
    return this.createEntityEntryUrl(referenceName);
  }

  createEntityDetailUrl(referenceName: string, params: ContelloEntityDetailParams): string {
    const base = this.createEntityEntryUrl(referenceName);

    if (params.mode === 'create') {
      return `${base}/create`;
    }

    return `${base}/${params.mode}/${params.id}`;
  }

  /**
   * @deprecated Use createEntityDetailUrl instead
   */
  createEntityUrl(referenceName: string, entityId: string): string {
    return this.createEntityDetailUrl(referenceName, { mode: 'edit', id: entityId });
  }

  createExtensionUrl(
    referenceName: string,
    params?: {
      path?: string[];
      query?: { [prop: string]: string };
    },
  ): string {
    const path = params?.path?.join('/') || '';
    const query = new URLSearchParams(params?.query || {}).toString();

    return `${this.createProjectUrl()}/extensions/${referenceName}${path ? `/${path}` : ''}${query ? `?${query}` : ''}`;
  }

  navigate(url: string) {
    return this.channel.call('navigate', { url });
  }

  displayNotification(type: 'success' | 'error', message: string) {
    return this.channel.call('displayNotification', { type, message });
  }

  openDialog<D, T>(options: ContelloDialogOptions<D>): ContelloDialogRef<D, T> {
    const controller = {
      connected: new Deferred<void>(),
      ready: new Deferred<void>(),
      complete: new Deferred<T>(),
      close: () => {
        if (!this.channel) {
          throw new Error('The channel is not yet initialized');
        }

        this.channel.call('closeDialog', { id: dialog.id as string });
        this.dialogs.delete(dialog);
      },
    };

    const dialog = new ContelloDialogRef<D, T>({ channel: this.channel, options, controller });

    this.dialogs.set(dialog, controller);

    dialog.complete.then(() => this.dialogs.delete(dialog));

    return dialog;
  }

  private listenForResize() {
    this.resizeObserver = new ResizeObserver(() => {
      this.channel.call('resize', { height: this.getWindowHeight() });
    });

    this.resizeObserver.observe(document.documentElement);
  }

  private getWindowHeight() {
    // adapted from https://javascript.info/size-and-scroll-window
    return Math.max(document.body.scrollHeight, document.body.offsetHeight, document.body.clientHeight);
  }

  private getDialogController(id: string) {
    const key = Array.from(this.dialogs.keys()).find((dialog) => dialog.id === id);

    if (!key) {
      return;
    }

    return this.dialogs.get(key);
  }
}
