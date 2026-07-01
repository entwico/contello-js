import type { Client } from 'graphql-ws';

// how long connect() waits for an individual client's first `connected` event
// before resolving optimistically. without this a single unreachable endpoint
// (graphql-ws retries forever) would make init() hang indefinitely; the client
// keeps retrying in the background and get() routes around it via failover.
const DEFAULT_CONNECT_TIMEOUT = 10_000;

export class ConnectionPool {
  private _clients: Client[] = [];
  private _connected: boolean[] = [];
  private _currentIndex = 0;

  constructor(
    private _createClient: (id: string) => Client,
    private _poolSize: number,
    private _connectTimeout = DEFAULT_CONNECT_TIMEOUT,
  ) {}

  async connect() {
    const ready: Promise<void>[] = [];

    for (let i = 0; i < this._poolSize; i++) {
      const index = i;
      const client = this._createClient(String(i + 1));

      this._clients.push(client);
      this._connected.push(false);

      client.on('connected', () => {
        this._connected[index] = true;
      });
      client.on('closed', () => {
        this._connected[index] = false;
      });

      ready.push(
        new Promise<void>((resolve) => {
          let settled = false;

          const done = () => {
            if (settled) {
              return;
            }

            settled = true;
            offConnected();
            clearTimeout(timer);
            resolve();
          };

          const offConnected = client.on('connected', done);
          const timer = setTimeout(done, this._connectTimeout);

          timer.unref?.();
        }),
      );
    }

    await Promise.all(ready);
  }

  get() {
    if (this._clients.length === 0) {
      throw new Error('@contello/client: connection pool is empty — call client.init() first');
    }

    // prefer a currently-connected client, scanning round-robin from the cursor
    for (let i = 0; i < this._clients.length; i++) {
      const index = (this._currentIndex + i) % this._clients.length;

      if (this._connected[index] === true) {
        this._currentIndex = (index + 1) % this._clients.length;

        return this._clients[index]!;
      }
    }

    // none known-connected — fall back to plain round-robin; graphql-ws buffers
    // the operation until the chosen socket reconnects
    const client = this._clients[this._currentIndex]!;

    this._currentIndex = (this._currentIndex + 1) % this._clients.length;

    return client;
  }

  async disconnect() {
    const closed = this._clients.map(
      (client) =>
        new Promise<void>((resolve) => {
          const unsubscribe = client.on('closed', () => {
            unsubscribe();
            resolve();
          });

          client.dispose();
        }),
    );

    this._clients = [];
    this._connected = [];
    this._currentIndex = 0;

    await Promise.all(closed);
  }
}
