import type { Client } from 'graphql-ws';

export class ConnectionPool {
  private clients: Array<Client> = [];
  private currentIndex = 0;

  constructor(
    private createClient: (id: string) => Client,
    private poolSize: number,
  ) {}

  connect() {
    for (let i = 0; i < this.poolSize; i++) {
      this.clients.push(this.createClient(`${i + 1}`));
    }
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

  disconnect() {
    this.clients.forEach((client) => client.dispose());
    this.clients = [];
  }
}
