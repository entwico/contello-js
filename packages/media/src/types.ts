export type MediaFileMetadata = {
  width: number;
  height: number;
};

export type MediaFile = {
  uid: string;
  mimeType: string;
  metadata?: MediaFileMetadata | null | undefined;
};

export type MediaOptimizedFile = MediaFile & {
  optimizationConfig?: { name: string } | null | undefined;
};

export type MediaAsset = {
  id: string;
  original: MediaFile;
  preview?: MediaFile | null | undefined;
  optimized: MediaOptimizedFile[];
};

export type ImageDefVariant = {
  type: string;
  url: string;
  width: number;
  height: number;
};

export type ImageDef = {
  id: string;
  variants: ImageDefVariant[];
};

/**
 * render-ready shape for a `<picture>` element. fully sparse — every field is
 * optional and only set when it carries non-default information, so hydration
 * payloads stay minimal when passed to React islands.
 */
export type PictureSource = {
  /** source asset id — useful for debugging/tracking */
  id?: string | undefined;
  image?:
    | {
        url?: string | undefined;
        /** multi-width srcset — set only when there's more than one variant of the main format */
        srcset?: string | undefined;
        /** sizes attribute — set only when a non-default (non-`100vw`) value applies */
        sizes?: string | undefined;
        /** intrinsic dimensions — set only when source metadata was present */
        width?: number | undefined;
        height?: number | undefined;
      }
    | undefined;
  /** `<source>` entries — set only when additional-format variants are available */
  sources?:
    | Array<{
        type: string;
        srcset: string;
        sizes: string;
      }>
    | undefined;
};

export type VideoDef = {
  id: string;
  url: string;
  width: number;
  height: number;
};

export type FileDef = {
  id: string;
  url: string;
};
