import { fileURLToPath } from 'node:url';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));

/**
 * resolved absolute paths to the `.gql` fragment files shipped with this
 * package. intended for use in a codegen `documents` config so consumers
 * don't have to hardcode `node_modules/@contello/media/fragments/*.gql`.
 */
export const fragments: string[] = [`${packageRoot}fragments/asset.gql`];
