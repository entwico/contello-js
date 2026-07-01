import type {
  DeepReadonly,
  FileSource,
  ImageDef,
  ImageDefVariant,
  ImageInput,
  ImageMetadata,
  ImageSource,
  MediaAsset,
  MediaFile,
  VideoSource,
} from './types';

export type ImageUrlTarget = 'web' | 'email' | 'pdf' | 'og' | 'videoPoster' | 'safe';

// input aliases — the resolver only reads its sources, so it accepts deeply
// immutable values (e.g. frozen store entities) and builds fresh mutable output.
type ImageInputArg = DeepReadonly<ImageInput>;
type MediaAssetInput = DeepReadonly<MediaAsset>;
type VideoSourceInput = DeepReadonly<VideoSource>;

/** a fallback image with an explicit id (to tell multiple fallbacks apart via `ImageSource.id`) */
type NamedFallback = { id: string; image: ImageInputArg };
/** acceptable fallback: any image input, optionally named */
type FallbackOption = ImageInputArg | NamedFallback;

type WithFallback = { fallback?: FallbackOption | undefined };
type HasFallback<O> = O extends { fallback: infer F } ? ([F] extends [undefined] ? false : true) : false;

export type ImageUrlOverrides = {
  minWidth?: number | undefined;
  maxWidth?: number | undefined;
} & WithFallback;

export type ImageSourceOptions = {
  formats?: string[] | undefined;
} & WithFallback;

export type MediaResolverOptions = {
  baseUrl?: string | undefined;
  imagesPath?: string | undefined;
  videosPath?: string | undefined;
  filesPath?: string | undefined;
  /** default `<source>` formats. AVIF only; add `'image/webp'` to re-enable WebP */
  pictureFormats?: string[] | undefined;
} & WithFallback;

/** normalized resolver configuration — inputs with defaults applied; exposed via `MediaResolver.config` */
export type MediaConfig<HasDefault extends boolean = false> = {
  baseUrl: string;
  imagesPath: string;
  videosPath: string;
  filesPath: string;
  formats: string[];
  fallback: HasDefault extends true ? ImageDef : ImageDef | undefined;
};

const DEFAULT_FORMATS = ['image/avif'];

const MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'application/pdf': 'pdf',
};

type TargetSpec = {
  priority: string[];
  minWidth?: number;
  maxWidth?: number;
  /** in-range selection order: 'smallest' = bandwidth-conservative (default), 'largest' = best quality near maxWidth */
  prefer?: 'smallest' | 'largest';
};

// destination presets — priority lists are ordered most-preferred first
const TARGETS: Record<ImageUrlTarget, TargetSpec> = {
  web: { priority: ['image/webp', 'image/jpeg', 'image/png'] },
  videoPoster: { priority: ['image/webp', 'image/jpeg', 'image/png'] },
  email: { priority: ['image/jpeg', 'image/png'], maxWidth: 1200 },
  pdf: { priority: ['image/jpeg', 'image/png'] },
  // social cards display at ~1200px — take the largest jpeg/png within 600-1200
  og: { priority: ['image/jpeg', 'image/png'], minWidth: 600, maxWidth: 1200, prefer: 'largest' },
  safe: { priority: ['image/jpeg', 'image/png'] },
};

// priority used for the `<img>` fallback inside `<picture>` — legacy formats win
// so modern browsers follow the `<source>` cascade instead
const PICTURE_IMG_FALLBACK_PRIORITY = ['image/svg+xml', 'image/png', 'image/jpeg', 'image/webp', 'image/avif'];

// width cap for the bare `<img src>` fallback (only no-srcset browsers use it) — pick a
// mid-size variant, not the asset's largest. the full srcset is still emitted alongside.
const PICTURE_IMG_FALLBACK_MAX_WIDTH = 1200;

const EMPTY_IMAGE: ImageSource = {};

export class MediaResolver<HasDefault extends boolean = false> {
  /** normalized configuration (base url, paths, formats, fallback) */
  readonly config: MediaConfig<HasDefault>;

  readonly image: {
    source(source: ImageInputArg | null | undefined, options?: ImageSourceOptions): ImageSource;
    url(source: ImageInputArg | null | undefined, target: ImageUrlTarget, overrides?: ImageUrlOverrides): string;
  };

  readonly video: {
    source(source: MediaAssetInput): VideoSource;
    m3u8(source: VideoSourceInput | MediaAssetInput): string;
  };

  readonly file: {
    source(source: MediaAssetInput): FileSource;
  };

  constructor(options: MediaResolverOptions) {
    this.config = {
      baseUrl: (options.baseUrl ?? '').replace(/\/$/, ''),
      imagesPath: options.imagesPath ? normalizePath(options.imagesPath) : '/',
      videosPath: options.videosPath ? normalizePath(options.videosPath) : '/',
      filesPath: options.filesPath ? normalizePath(options.filesPath) : '/',
      formats: options.pictureFormats ?? DEFAULT_FORMATS,
      // normalized just below — resolving a MediaAsset fallback needs the paths above
      fallback: undefined as MediaConfig<HasDefault>['fallback'],
    };

    this.config.fallback = this.normalizeFallback(options.fallback) as MediaConfig<HasDefault>['fallback'];

    this.image = {
      source: (source, options) => this.resolveImageSource(source, options),
      url: (source, target, overrides) => this.resolveImageUrl(source, target, overrides),
    };

    this.video = {
      source: (source) => this.resolveVideoSource(source),
      m3u8: (source) => this.resolveM3u8(source),
    };

    this.file = {
      source: (source) => this.resolveFileSource(source),
    };
  }

  private imageUrl(uid: string, mimeType: string): string {
    const extension = MIME_EXTENSIONS[mimeType];

    return `${this.config.baseUrl}${this.config.imagesPath}${uid}${extension ? `.${extension}` : ''}`;
  }

  private fileUrl(uid: string, mimeType: string): string {
    const extension = MIME_EXTENSIONS[mimeType];

    return `${this.config.baseUrl}${this.config.filesPath}${uid}${extension ? `.${extension}` : ''}`;
  }

  private buildM3u8(assetId: string): string {
    return `${this.config.baseUrl}${this.config.videosPath}${assetId}/master.m3u8`;
  }

  private resolveImageUrl(
    source: ImageInputArg | null | undefined,
    target: ImageUrlTarget,
    overrides?: ImageUrlOverrides,
  ): string {
    const { def } = this.resolveImage(source, overrides?.fallback);

    if (!def) {
      return '';
    }

    const spec = TARGETS[target];
    const minWidth = overrides?.minWidth ?? spec.minWidth;
    const maxWidth = overrides?.maxWidth ?? spec.maxWidth;
    const variant = pickVariant(def.variants, spec.priority, minWidth, maxWidth, spec.prefer);

    return variant?.url ?? '';
  }

  private resolveImageSource(source: ImageInputArg | null | undefined, options?: ImageSourceOptions): ImageSource {
    const { def, isFallback } = this.resolveImage(source, options?.fallback);

    if (!def || def.variants.length === 0) {
      return EMPTY_IMAGE;
    }

    const formats = [...new Set(options?.formats ?? this.config.formats)];
    const byType = groupVariantsByType(def.variants);
    const sources: NonNullable<ImageSource['sources']> = [];

    for (const format of formats) {
      const variants = byType.get(format);

      if (!variants || variants.length === 0) {
        continue;
      }

      sources.push({ type: format, srcset: toSrcset(variants) });
    }

    // the <img> is the fallback for browsers that match no <source>. its bare `src` is capped
    // (largest within the cap) so those browsers don't pull the absolute-largest variant.
    const mainVariant =
      pickVariant(def.variants, PICTURE_IMG_FALLBACK_PRIORITY, undefined, PICTURE_IMG_FALLBACK_MAX_WIDTH, 'largest') ??
      def.variants[0];

    if (!mainVariant) {
      return EMPTY_IMAGE;
    }

    const mainTypeVariants = byType.get(mainVariant.type) ?? [mainVariant];
    const image: NonNullable<ImageSource['image']> = {};

    if (mainVariant.url) {
      image.url = mainVariant.url;
    }

    // the <img> only needs its own srcset when there are no <source>s (it's then the sole
    // responsive candidate); with <source>s present the browser ignores the <img>'s srcset.
    if (sources.length === 0 && mainTypeVariants.length > 1) {
      image.srcset = toSrcset(mainTypeVariants);
    }

    // intrinsic dimensions come from the largest variant (the full image), not the capped <img>
    // `src` — so consumers can size an element to the real aspect ratio while `sizes="auto"`
    // still picks the right responsive width.
    const largestVariant = def.variants.reduce((a, b) => (b.width > a.width ? b : a));

    if (largestVariant.width > 0) {
      image.width = largestVariant.width;
    }

    if (largestVariant.height > 0) {
      image.height = largestVariant.height;
    }

    const result: ImageSource = {};

    if (def.id) {
      result.id = def.id;
    }

    if (isFallback) {
      result.fallback = true;
    }

    if (Object.keys(image).length > 0) {
      result.image = image;
    }

    if (sources.length > 0) {
      result.sources = sources;
    }

    return result;
  }

  private resolveVideoSource(source: MediaAssetInput): VideoSource {
    return {
      id: source.id,
      url: this.buildM3u8(source.id),
      width: source.original.metadata?.width ?? 0,
      height: source.original.metadata?.height ?? 0,
    };
  }

  private resolveM3u8(source: VideoSourceInput | MediaAssetInput): string {
    if (isVideoSource(source)) {
      return source.url;
    }

    return this.buildM3u8(source.id);
  }

  private resolveFileSource(source: MediaAssetInput): FileSource {
    return {
      id: source.id,
      url: this.fileUrl(source.original.uid, source.original.mimeType),
      mimeType: source.original.mimeType,
    };
  }

  // resolves an input to a normalized def, applying the per-call/configured fallback when the
  // input is missing or empty. `isFallback` flags that the fallback was substituted.
  private resolveImage(
    source: ImageInputArg | null | undefined,
    perCallFallback: FallbackOption | undefined,
  ): { def: ImageDef | undefined; isFallback: boolean } {
    const def = this.toDef(source);

    if (def && def.variants.length > 0) {
      return { def, isFallback: false };
    }

    const fallback = perCallFallback === undefined ? this.config.fallback : this.normalizeFallback(perCallFallback);

    return { def: fallback, isFallback: fallback !== undefined };
  }

  // converts any image input (asset, bundled metadata, or metadata list) into a normalized def
  private toDef(input: ImageInputArg | null | undefined): ImageDef | undefined {
    if (!input) {
      return undefined;
    }

    // Array.isArray doesn't narrow a `readonly T[]` out of the union, so the non-array
    // branches are cast to the remaining members explicitly
    if (Array.isArray(input)) {
      const metadata = input as readonly DeepReadonly<ImageMetadata>[];
      const variants = metadata.map((m) => metadataToVariant(m));

      return variants.length > 0 ? { id: '', variants } : undefined;
    }

    const single = input as DeepReadonly<MediaAsset> | DeepReadonly<ImageMetadata>;

    if ('original' in single) {
      return this.assetToImageDef(single);
    }

    return { id: '', variants: [metadataToVariant(single)] };
  }

  // normalizes a fallback option into a def, defaulting the id to `'fallback'` for bundled images
  private normalizeFallback(fallback: FallbackOption | undefined): ImageDef | undefined {
    if (!fallback) {
      return undefined;
    }

    if (!Array.isArray(fallback) && 'image' in fallback) {
      const def = this.toDef(fallback.image);

      return def ? { id: fallback.id, variants: def.variants } : undefined;
    }

    const def = this.toDef(fallback);

    if (!def) {
      return undefined;
    }

    return def.id ? def : { id: 'fallback', variants: def.variants };
  }

  private assetToImageDef(asset: MediaAssetInput): ImageDef {
    const { id, original, preview, optimized } = asset;

    // SVG originals are already scalable and universally supported — use the
    // original directly, skip everything else (no raster variants apply)
    if (original.mimeType === 'image/svg+xml') {
      return { id, variants: compactVariant(this.fileToVariant(original)) };
    }

    // raster: include optimized variants + the preview (contello's preview is a ~1000px-bounded JPEG).
    // the browser picks responsive widths via srcset descriptors; the preview also participates
    // as the largest jpeg, so size-based targets (og, <img> fallback) land on it naturally.
    const variants: ImageDefVariant[] = [];

    for (const file of optimized) {
      const variant = this.fileToVariant(file);

      if (variant) {
        variants.push(variant);
      }
    }

    const previewVariant = this.fileToVariant(preview);

    if (previewVariant) {
      variants.push(previewVariant);
    }

    return { id, variants };
  }

  private fileToVariant(file: DeepReadonly<MediaFile> | null | undefined): ImageDefVariant | null {
    if (!file?.metadata) {
      return null;
    }

    return {
      type: file.mimeType,
      width: file.metadata.width,
      height: file.metadata.height,
      url: this.imageUrl(file.uid, file.mimeType),
    };
  }
}

export function createMediaResolver<O extends MediaResolverOptions>(options: O): MediaResolver<HasFallback<O>> {
  return new MediaResolver(options) as MediaResolver<HasFallback<O>>;
}

function normalizePath(path: string): string {
  const withLeading = path.startsWith('/') ? path : `/${path}`;

  return withLeading.endsWith('/') ? withLeading : `${withLeading}/`;
}

function isVideoSource(source: VideoSourceInput | MediaAssetInput): source is VideoSourceInput {
  return 'url' in source;
}

function metadataToVariant(metadata: DeepReadonly<ImageMetadata>): ImageDefVariant {
  return {
    type: `image/${metadata.format}`,
    url: metadata.src,
    width: metadata.width,
    height: metadata.height,
  };
}

function compactVariant(variant: ImageDefVariant | null): ImageDefVariant[] {
  return variant ? [variant] : [];
}

function groupVariantsByType(variants: ImageDefVariant[]): Map<string, ImageDefVariant[]> {
  const map = new Map<string, ImageDefVariant[]>();

  for (const v of variants) {
    const list = map.get(v.type);

    if (list) {
      list.push(v);
    } else {
      map.set(v.type, [v]);
    }
  }

  return map;
}

// dedupe by width descriptor: a srcset must not list two candidates at the same width (the
// browser discards one). keep the first after the ascending sort.
function toSrcset(variants: ImageDefVariant[]): string {
  const byWidth = new Map<number, ImageDefVariant>();
  const sorted = [...variants].toSorted((a, b) => a.width - b.width);

  for (const v of sorted) {
    if (!byWidth.has(v.width)) {
      byWidth.set(v.width, v);
    }
  }

  return byWidth.values().map((v) => `${v.url} ${v.width}w`).toArray().join(', ');
}

/**
 * picks a variant from within size constraints, honoring a priority order.
 * - higher priority (earlier in `priority`) wins
 * - within same priority tier, `prefer` chooses smallest width (bandwidth-conservative,
 *   the default) or largest width (best quality near `maxWidth`)
 * - if nothing matches priority, returns the smallest variant in the filtered set
 *
 * graceful degradation when the size range is empty: prefer the largest variant
 * below `minWidth` (closest match without upscaling); otherwise the smallest
 * variant above `maxWidth`. format priority is still honored within the fallback.
 */
function pickVariant(
  variants: ImageDefVariant[],
  priority: string[],
  minWidth: number | undefined,
  maxWidth: number | undefined,
  prefer: 'smallest' | 'largest' = 'smallest',
): ImageDefVariant | undefined {
  if (variants.length === 0) {
    return undefined;
  }

  const inRange = variants.filter((v) => {
    if (minWidth !== undefined && v.width < minWidth) return false;

    return !(maxWidth !== undefined && v.width > maxWidth);
  });

  if (inRange.length > 0) {
    return pickByPriorityWithOrder(inRange, priority, prefer === 'largest' ? 'desc' : 'asc');
  }

  if (minWidth !== undefined) {
    const below = variants.filter((v) => v.width < minWidth);

    if (below.length > 0) {
      return pickByPriorityWithOrder(below, priority, 'desc');
    }
  }

  return pickByPriorityWithOrder(variants, priority, 'asc');
}

function pickByPriorityWithOrder(
  variants: ImageDefVariant[],
  priority: string[],
  order: 'asc' | 'desc',
): ImageDefVariant {
  const cmp =
    order === 'asc'
      ? (a: ImageDefVariant, b: ImageDefVariant) => a.width - b.width
      : (a: ImageDefVariant, b: ImageDefVariant) => b.width - a.width;

  for (const format of priority) {
    const ofFormat = variants.filter((v) => v.type === format);

    if (ofFormat.length > 0) {
      return [...ofFormat].toSorted(cmp)[0]!;
    }
  }

  return [...variants].toSorted(cmp)[0]!;
}
