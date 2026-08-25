import type { SourceCardinality, SourceMutations } from './types';

/**
 * Write bindings for the built-in sources. Unlike entity mutations these are not derived — their
 * field and argument names are fixed parts of every Contello schema — but the generator still
 * checks each one against the introspected schema before emitting it, so a server without them
 * (or with a different shape) simply yields a read-only source.
 *
 * Routes are the odd ones: `updateContelloRoute` is keyed by the `path` inside its input rather
 * than by an id, and it replaces the route rather than patching it. `deleteContelloRoute` takes a
 * bare `id` and answers with a bare id string.
 *
 * Assets have no `create` — an asset comes into being through `client.upload()`, not a mutation.
 */
export const BUILT_IN_MUTATIONS: Partial<Record<SourceCardinality, SourceMutations>> = {
  route: {
    create: {
      field: 'createContelloRoute',
      arguments: [{ name: 'route', type: 'ContelloRouteInput!', from: 'input' }],
      result: 'entity',
    },
    update: {
      field: 'updateContelloRoute',
      arguments: [{ name: 'route', type: 'ContelloRouteInput!', from: 'input' }],
      result: 'entity',
    },
    delete: {
      field: 'deleteContelloRoute',
      arguments: [{ name: 'id', type: 'String', from: 'id' }],
      result: 'idScalar',
    },
  },
  asset: {
    update: {
      field: 'updateContelloAsset',
      arguments: [{ name: 'request', type: 'ContelloAssetUpdateInput!', from: 'input' }],
      result: 'entity',
    },
    delete: {
      field: 'deleteContelloAsset',
      arguments: [{ name: 'id', type: 'String!', from: 'id' }],
      result: 'idObject',
    },
  },
};
