import { log } from '@astroscope/pino';
import { ComponentMapper, NO_MATCH } from '@contello/store';
import type { ComponentFragment } from '@/server/_/gql/graphql';

export type Component =
  | { type: 'text'; markdownData: string }
  | { type: 'section'; headline: string; content: Component[] };

export const componentMapper = new ComponentMapper<ComponentFragment, Component>({
  TextComponent: (c) => c.text?.markdownData && { type: 'text', markdownData: c.text.markdownData },
  SectionComponent: (c, map) => ({ type: 'section', headline: c.headline ?? '', content: map(c.content) }),
  [NO_MATCH]: (c) => log.warn({ typename: c.__typename }, 'unhandled component'),
});
