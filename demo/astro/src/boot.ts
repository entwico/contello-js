import type { BootContext } from '@astroscope/boot';
import { checks } from '@astroscope/health';
import { log } from '@astroscope/pino';
import { ContelloInstrumentation } from '@contello/opentelemetry';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { stdTimeFunctions } from 'pino';
import { Config } from '@/config';
import { categories } from '@/server/categories';
import { contello } from '@/server/contello';

const sdk = new NodeSDK({
  instrumentations: [new ContelloInstrumentation()],
});

export async function onStartup({ host, port }: BootContext) {
  log.configure({
    level: Config.logger.level,
    formatters: { level: (label: string) => ({ level: label }) },
    timestamp: Config.logger.withTimestamp ? stdTimeFunctions.isoTime : false,
    ...(!Config.logger.withDefaultBindings ? { base: null } : {}),
  });

  sdk.start();

  checks.register('contello', () => contello.ping());

  await contello.init({ load: [categories] });

  log.info({ host, port }, 'server ready');
}

export async function onShutdown() {
  log.info('shutting down');

  await contello.destroy();
  await sdk.shutdown();

  log.info('shutdown complete');
}
