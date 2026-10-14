declare module 'virtual:@contello/astro/instance' {
  import type { Contello } from './contello';
  export const contello: Contello<any>;
}

declare module 'virtual:@contello/astro/config' {
  import type { ExcludePattern } from '@astroscope/node/excludes';
  export const exclude: ExcludePattern[] | null;
}
