import type { StoreRouteFragment } from './generated/graphql';
import type { ModelResolver } from './model-resolver';

export type StoreRouteCustomHeader = {
  name: string;
  value: string;
};

export type StoreRoute = {
  id: string;
  path: string;
  customHeaders: StoreRouteCustomHeader[];
} & (
  | { type: 'redirect'; location: string; status: number }
  | { type: 'text'; content: string; mimeType: string }
  | { type: 'asset'; assetId: string; fileId: string; contentDisposition: 'inline' | 'attachment'; mimeType: string }
  | { type: 'entity'; model: string; entityType: string; entityId: string }
);

export function mapRoute(raw: StoreRouteFragment, resolver: ModelResolver): StoreRoute | undefined {
  const base = {
    id: raw.id,
    path: raw.path,
    customHeaders: raw.customHeaders.map((h) => ({ name: h.name, value: h.value })),
  };

  switch (raw.target.__typename) {
    case 'ContelloRouteTargetRedirect':
      return {
        ...base,
        type: 'redirect',
        location: raw.target.location,
        status: raw.target.responseCode,
      };

    case 'ContelloRouteTargetText':
      return {
        ...base,
        type: 'text',
        content: raw.target.content,
        mimeType: raw.target.mimeType,
      };

    case 'ContelloRouteTargetAsset':
      return {
        ...base,
        type: 'asset',
        assetId: raw.target.asset.id,
        fileId: raw.target.asset.original.uid,
        contentDisposition: raw.target.contentDisposition === 'INLINE' ? 'inline' : 'attachment',
        mimeType: raw.target.asset.original.mimeType,
      };

    case 'ContelloRouteTargetEntity': {
      if (!raw.target.entity) {
        return undefined;
      }

      const entityType = raw.target.entity.__typename;

      return {
        ...base,
        type: 'entity',
        model: resolver.resolveModel(entityType),
        entityType,
        entityId: raw.target.entity.id,
      };
    }

    default:
      return undefined;
  }
}
