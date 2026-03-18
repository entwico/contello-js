import { log } from '@astroscope/pino';
import type { ComponentFragment } from '@/server/_/gql/graphql';

export type Component =
  | { type: 'text'; markdownData: string }
  | { type: 'section'; headline: string; content: Component[] }
  | { type: 'productList'; headline: string; productIds: string[] };

function mapComponent(c: ComponentFragment): Component | undefined {
  switch (c.__model) {
    case 'text':
      return c.text?.markdownData ? { type: 'text', markdownData: c.text.markdownData } : undefined;

    case 'section':
      return { type: 'section', headline: c.headline ?? '', content: mapComponents(c.content) };

    case 'productList':
      return { type: 'productList', headline: c.headline ?? '', productIds: (c.products ?? []).map((p) => p.id) };

    default:
      log.warn({ model: (c as { __model: string }).__model }, 'unhandled component');

      return undefined;
  }
}

export function mapComponents(components: readonly ComponentFragment[] = []): Component[] {
  return components.flatMap((c) => {
    const result = mapComponent(c);

    return result ? [result] : [];
  });
}
