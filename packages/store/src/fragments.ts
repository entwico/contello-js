import { fileURLToPath } from 'node:url';

import { fragments as mediaFragments } from '@contello/media/fragments';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));

/**
 * resolved absolute paths to the `.gql` fragment files that store-backed
 * codegen should include. combines media's primitives with store's own
 * `StoreAsset` / `StoreRoute` fragments. intended for use in a project's
 * codegen `documents` config.
 */
export const fragments: string[] = [
  ...mediaFragments,
  `${packageRoot}fragments/asset.gql`,
  `${packageRoot}fragments/route.gql`,
];
