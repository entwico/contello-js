// recursively makes every property and array element readonly. used to widen
// the resolver's input signatures so they accept deeply immutable media values
// (e.g. frozen store entities) without forcing casts at the call site.
export type DeepReadonly<T> = T extends (infer U)[]
  ? readonly DeepReadonly<U>[]
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

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

/**
 * a bundled/static image — structurally compatible with astro's `ImageMetadata`
 * (`import img from './x.png'`), so those imports are accepted directly without an
 * astro dependency.
 */
export type ImageMetadata = {
  src: string;
  width: number;
  height: number;
  format: string;
};

/** anything the image methods accept as a source: a CMS asset, or bundled image(s) */
export type ImageInput = MediaAsset | ImageMetadata | ImageMetadata[];

/** internal normalized image: id + the variant set the resolver renders from */
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
export type ImageSource = {
  /** source asset id — useful for debugging/tracking, and to tell fallbacks apart */
  id?: string | undefined;
  /** set to `true` only when the resolver substituted the configured/per-call fallback */
  fallback?: true | undefined;
  image?:
    | {
      url?: string | undefined;
      /** multi-width srcset — set only when there's more than one variant of the main format */
      srcset?: string | undefined;
      /** intrinsic dimensions — set only when source metadata was present */
      width?: number | undefined;
      height?: number | undefined;
    }
    | undefined;
  /** `<source>` entries — set only when additional-format variants are available. `sizes` is applied at render */
  sources?:
    | Array<{
      type: string;
      srcset: string;
    }>
    | undefined;
};

export type VideoSource = {
  id: string;
  url: string;
  width: number;
  height: number;
};

export type FileSource = {
  id: string;
  url: string;
  mimeType: string;
};
