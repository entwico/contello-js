import type { Client } from 'graphql-ws';

export class ConnectionPool {
  private clients: Array<Client> = [];
  private currentIndex = 0;

  constructor(
    private createClient: (id: string) => Client,
    private poolSize: number,
  ) {}

  async connect() {
    const connected: Promise<void>[] = [];

    for (let i = 0; i < this.poolSize; i++) {
      const client = this.createClient(`${i + 1}`);
      this.clients.push(client);

      connected.push(
        new Promise<void>((resolve) => {
          const unsubscribe = client.on('connected', () => {
            unsubscribe();
            resolve();
          });
        }),
      );
    }

    await Promise.all(connected);
  }

  get() {
    if (this.clients.length === 0) {
      throw new Error('Connection pool is empty. Please call connect() first.');
    }

    const client = this.clients[this.currentIndex];

    this.currentIndex = (this.currentIndex + 1) % this.poolSize;

    if (!client) {
      throw new Error('No available WebSocket client');
    }

    return client;
  }

  async disconnect() {
    const closed = this.clients.map(
      (client) =>
        new Promise<void>((resolve) => {
          const unsubscribe = client.on('closed', () => {
            unsubscribe();
            resolve();
          });

          client.dispose();
        }),
    );

    this.clients = [];

    await Promise.all(closed);
  }
}
