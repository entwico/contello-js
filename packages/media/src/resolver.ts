import type { FileDef, ImageDef, ImageDefVariant, MediaAsset, MediaFile, PictureSource, VideoDef } from './types';

export type BreakpointConfig = {
  /** media query fragment for the `sizes` attribute (e.g. `(min-width: 768px)`). `undefined` = default clause */
  mediaQuery: string | undefined;
  /** pixel threshold used to order breakpoints largest-first */
  minWidth: number;
};

export type ImageUrlTarget = 'web' | 'email' | 'pdf' | 'og' | 'videoPoster' | 'safe';

type WithFallback = { fallback?: ImageDef | undefined };
type HasFallback<O> = O extends { fallback: ImageDef } ? true : false;

export type ImageUrlOverrides = {
  minWidth?: number | undefined;
  maxWidth?: number | undefined;
} & WithFallback;

export type PictureOptions = {
  sourceWidth?: Record<string, number> | undefined;
  breakpoints?: Record<string, BreakpointConfig> | undefined;
  formats?: string[] | undefined;
} & WithFallback;

export type MediaResolverOptions = {
  baseUrl?: string | undefined;
  imagesPath?: string | undefined;
  videosPath?: string | undefined;
  filesPath?: string | undefined;
  /** project-wide responsive breakpoints. defaults to a standard Tailwind set */
  breakpoints?: Record<string, BreakpointConfig> | undefined;
  /** default `<source>` formats emitted by `picture.src`. defaults to AVIF + WebP */
  pictureFormats?: string[] | undefined;
} & WithFallback;

type ImageDefMethod<HasDefault extends boolean> = {
  (source: MediaAsset, fallback?: ImageDef): ImageDef;
  (source: MediaAsset | null | undefined, fallback: ImageDef): ImageDef;
  (source: MediaAsset | null | undefined): HasDefault extends true ? ImageDef : ImageDef | undefined;
};

const DEFAULT_BREAKPOINTS: Record<string, BreakpointConfig> = {
  _: { mediaQuery: undefined, minWidth: 0 },
  sm: { mediaQuery: '(min-width: 640px)', minWidth: 640 },
  md: { mediaQuery: '(min-width: 768px)', minWidth: 768 },
  lg: { mediaQuery: '(min-width: 1024px)', minWidth: 1024 },
  xl: { mediaQuery: '(min-width: 1280px)', minWidth: 1280 },
  '2xl': { mediaQuery: '(min-width: 1536px)', minWidth: 1536 },
};

const DEFAULT_FORMATS = ['image/avif', 'image/webp'];

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
};

// destination presets — priority lists are ordered most-preferred first
const TARGETS: Record<ImageUrlTarget, TargetSpec> = {
  web: { priority: ['image/webp', 'image/jpeg', 'image/png'] },
  videoPoster: { priority: ['image/webp', 'image/jpeg', 'image/png'] },
  email: { priority: ['image/jpeg', 'image/png'], maxWidth: 1200 },
  pdf: { priority: ['image/jpeg', 'image/png'] },
  og: { priority: ['image/jpeg', 'image/png'], minWidth: 600, maxWidth: 1200 },
  safe: { priority: ['image/jpeg', 'image/png'] },
};

// priority used for the `<img>` fallback inside `<picture>` — legacy formats win
// so modern browsers follow the `<source>` cascade instead
const PICTURE_IMG_FALLBACK_PRIORITY = ['image/svg+xml', 'image/png', 'image/jpeg', 'image/webp', 'image/avif'];

const EMPTY_PICTURE: PictureSource = {};

export class MediaResolver<HasDefault extends boolean = false> {
  readonly baseUrl: string;
  readonly imagesPath: string;
  readonly videosPath: string;
  readonly filesPath: string;
  readonly fallback: HasDefault extends true ? ImageDef : ImageDef | undefined;
  readonly breakpoints: Record<string, BreakpointConfig>;
  readonly formats: string[];

  readonly image: {
    def: ImageDefMethod<HasDefault>;
    url(
      source: ImageDef | MediaAsset | null | undefined,
      target: ImageUrlTarget,
      overrides?: ImageUrlOverrides,
    ): string;
  };

  readonly picture: {
    src(source: ImageDef | MediaAsset | null | undefined, options?: PictureOptions): PictureSource;
  };

  readonly video: {
    def(source: MediaAsset): VideoDef;
    m3u8(source: VideoDef | MediaAsset): string;
  };

  readonly file: {
    def(source: MediaAsset): FileDef;
  };

  constructor(options: MediaResolverOptions) {
    this.baseUrl = (options.baseUrl ?? '').replace(/\/$/, '');
    this.imagesPath = options.imagesPath ? normalizePath(options.imagesPath) : '/';
    this.videosPath = options.videosPath ? normalizePath(options.videosPath) : '/';
    this.filesPath = options.filesPath ? normalizePath(options.filesPath) : '/';
    this.fallback = options.fallback as typeof this.fallback;
    this.breakpoints = options.breakpoints ?? DEFAULT_BREAKPOINTS;
    this.formats = options.pictureFormats ?? DEFAULT_FORMATS;

    this.image = {
      def: ((source: MediaAsset | null | undefined, fallback?: ImageDef) =>
        this.resolveImageDef(source, fallback)) as ImageDefMethod<HasDefault>,

      url: (source, target, overrides) => this.resolveImageUrl(source, target, overrides),
    };

    this.picture = {
      src: (source, options) => this.resolvePicture(source, options),
    };

    this.video = {
      def: (source) => this.resolveVideoDef(source),
      m3u8: (source) => this.resolveM3u8(source),
    };

    this.file = {
      def: (source) => this.resolveFileDef(source),
    };
  }

  private imageUrl(uid: string, mimeType: string): string {
    const extension = MIME_EXTENSIONS[mimeType];

    return `${this.baseUrl}${this.imagesPath}${uid}${extension ? `.${extension}` : ''}`;
  }

  private fileUrl(uid: string, mimeType: string): string {
    const extension = MIME_EXTENSIONS[mimeType];

    return `${this.baseUrl}${this.filesPath}${uid}${extension ? `.${extension}` : ''}`;
  }

  private buildM3u8(assetId: string): string {
    return `${this.baseUrl}${this.videosPath}${assetId}/master.m3u8`;
  }

  private resolveImageDef(source: MediaAsset | null | undefined, fallback?: ImageDef): ImageDef | undefined {
    if (source) {
      return this.assetToImageDef(source);
    }

    return fallback ?? this.fallback;
  }

  private resolveImageUrl(
    source: ImageDef | MediaAsset | null | undefined,
    target: ImageUrlTarget,
    overrides?: ImageUrlOverrides,
  ): string {
    const def = this.toImageDef(source, overrides?.fallback);

    if (!def) {
      return '';
    }

    const spec = TARGETS[target];
    const minWidth = overrides?.minWidth ?? spec.minWidth;
    const maxWidth = overrides?.maxWidth ?? spec.maxWidth;
    const variant = pickVariant(def.variants, spec.priority, minWidth, maxWidth);

    return variant?.url ?? '';
  }

  private resolvePicture(source: ImageDef | MediaAsset | null | undefined, options?: PictureOptions): PictureSource {
    const def = this.toImageDef(source, options?.fallback);

    if (!def || def.variants.length === 0) {
      return EMPTY_PICTURE;
    }

    const breakpoints = options?.breakpoints ?? this.breakpoints;
    const formats = options?.formats ?? this.formats;
    const hasCustomSizes = !!options?.sourceWidth;
    const sizes = toSizesString(options?.sourceWidth, breakpoints);
    const byType = groupVariantsByType(def.variants);
    const sources: NonNullable<PictureSource['sources']> = [];

    for (const format of formats) {
      const variants = byType.get(format);

      if (!variants || variants.length === 0) {
        continue;
      }

      sources.push({ type: format, srcset: toSrcset(variants), sizes });
    }

    const mainVariant = pickByPriority(def.variants, PICTURE_IMG_FALLBACK_PRIORITY) ?? def.variants[0];

    if (!mainVariant) {
      return EMPTY_PICTURE;
    }

    const mainTypeVariants = byType.get(mainVariant.type) ?? [mainVariant];
    const image: NonNullable<PictureSource['image']> = {};

    if (mainVariant.url) {
      image.url = mainVariant.url;
    }

    if (mainTypeVariants.length > 1) {
      image.srcset = toSrcset(mainTypeVariants);
    }

    if (hasCustomSizes) {
      image.sizes = sizes;
    }

    if (mainVariant.width > 0) {
      image.width = mainVariant.width;
    }

    if (mainVariant.height > 0) {
      image.height = mainVariant.height;
    }

    const result: PictureSource = {};

    if (def.id) {
      result.id = def.id;
    }

    if (Object.keys(image).length > 0) {
      result.image = image;
    }

    if (sources.length > 0) {
      result.sources = sources;
    }

    return result;
  }

  private resolveVideoDef(source: MediaAsset): VideoDef {
    return {
      id: source.id,
      url: this.buildM3u8(source.id),
      width: source.original.metadata?.width ?? 0,
      height: source.original.metadata?.height ?? 0,
    };
  }

  private resolveM3u8(source: VideoDef | MediaAsset): string {
    if (isVideoDef(source)) {
      return source.url;
    }

    return this.buildM3u8(source.id);
  }

  private resolveFileDef(source: MediaAsset): FileDef {
    return {
      id: source.id,
      url: this.fileUrl(source.original.uid, source.original.mimeType),
    };
  }

  private toImageDef(source: ImageDef | MediaAsset | null | undefined, fallback?: ImageDef): ImageDef | undefined {
    if (!source) {
      return fallback ?? this.fallback;
    }

    if (isImageDef(source)) {
      return source;
    }

    return this.assetToImageDef(source);
  }

  private assetToImageDef(asset: MediaAsset): ImageDef {
    const { id, original, preview, optimized } = asset;

    // SVG originals are already scalable and universally supported — use the
    // original directly, skip everything else (no raster variants apply)
    if (original.mimeType === 'image/svg+xml') {
      return { id, variants: compactVariant(this.fileToVariant(original)) };
    }

    // raster: include optimized variants + the preview (contello's preview is a ~1000px-bounded JPEG).
    // browser picks via srcset width descriptors; OG picker lands on preview
    // naturally for its 600-1200px range.
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

  private fileToVariant(file: MediaFile | null | undefined): ImageDefVariant | null {
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

function isImageDef(source: ImageDef | MediaAsset): source is ImageDef {
  return 'variants' in source;
}

function isVideoDef(source: VideoDef | MediaAsset): source is VideoDef {
  return 'url' in source;
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

function toSrcset(variants: ImageDefVariant[]): string {
  return variants
    .slice()
    .sort((a, b) => a.width - b.width)
    .map((v) => `${v.url} ${v.width}w`)
    .join(', ');
}

function toSizesString(
  sourceWidth: Record<string, number> | undefined,
  breakpoints: Record<string, BreakpointConfig>,
): string {
  if (!sourceWidth) {
    return '100vw';
  }

  const entries: { mediaQuery: string | undefined; minWidth: number; widthPx: number }[] = [];

  for (const [key, widthPx] of Object.entries(sourceWidth)) {
    const bp = breakpoints[key];

    if (bp && widthPx) {
      entries.push({ mediaQuery: bp.mediaQuery, minWidth: bp.minWidth, widthPx });
    }
  }

  if (entries.length === 0) {
    return '100vw';
  }

  entries.sort((a, b) => b.minWidth - a.minWidth);

  const parts: string[] = [];
  let hasDefault = false;

  for (const entry of entries) {
    if (entry.mediaQuery === undefined) {
      parts.push(`${entry.widthPx}px`);
      hasDefault = true;

      continue;
    }

    parts.push(`${entry.mediaQuery} ${entry.widthPx}px`);
  }

  if (!hasDefault) {
    parts.push('100vw');
  }

  return parts.join(', ');
}

/**
 * picks a variant from within size constraints, honoring a priority order.
 * - higher priority (earlier in `priority`) wins
 * - within same priority tier, smallest width wins (bandwidth-conservative)
 * - if nothing matches priority, returns the smallest variant in the filtered set
 */
function pickVariant(
  variants: ImageDefVariant[],
  priority: string[],
  minWidth: number | undefined,
  maxWidth: number | undefined,
): ImageDefVariant | undefined {
  const filtered = variants.filter((v) => {
    if (minWidth !== undefined && v.width < minWidth) return false;
    if (maxWidth !== undefined && v.width > maxWidth) return false;

    return true;
  });

  if (filtered.length === 0) {
    return undefined;
  }

  for (const format of priority) {
    const ofFormat = filtered.filter((v) => v.type === format);

    if (ofFormat.length > 0) {
      return ofFormat.slice().sort((a, b) => a.width - b.width)[0];
    }
  }

  return filtered.slice().sort((a, b) => a.width - b.width)[0];
}

function pickByPriority(variants: ImageDefVariant[], priority: string[]): ImageDefVariant | undefined {
  for (const format of priority) {
    const match = variants.filter((v) => v.type === format);

    if (match.length > 0) {
      return match.slice().sort((a, b) => b.width - a.width)[0];
    }
  }

  return undefined;
}
