import { type ComponentPropsWithRef, type ComponentPropsWithoutRef, forwardRef } from 'react';

import { type SizesInput, resolveSizes } from '../sizes';
import type { DeepReadonly, ImageSource } from '../types';

export type ImgSpread = Omit<ComponentPropsWithoutRef<'img'>, 'src' | 'srcSet' | 'sizes'>;

/**
 * `sizes` is required for priority (eager) images — `sizes="auto"` is spec-illegal without
 * lazy loading, so they have no automatic sizing and must declare layout intent. lazy images
 * may omit it and fall back to `auto, 100vw`.
 */
export type SizesByPriority =
  | { priority: true; sizes: SizesInput }
  | { priority?: false | undefined; sizes?: SizesInput | undefined };

export type PictureBaseProps = {
  /** pre-resolved image data — obtain via `mediaResolver.image.source(source, options?)` */
  src: DeepReadonly<ImageSource>;
  /** attributes for the outer `<picture>` element (className, style, ref, data-*, aria-*, event handlers) */
  picture?: ComponentPropsWithRef<'picture'> | undefined;
  /**
   * shortcut for LCP images: sets `loading="eager"` + `fetchPriority="high"`.
   * explicit `loading` / `fetchPriority` props still win.
   */
  priority?: boolean | undefined;
  /** responsive sizes — a raw `sizes` string or a breakpoint-keyed `SizesMap`. required for priority images */
  sizes?: SizesInput | undefined;
  /**
   * render the `<picture>` as `display: contents` so its `<img>` participates
   * directly in the parent flex/grid layout (the wrapper leaves the box tree).
   */
  transparent?: boolean | undefined;
} & ImgSpread;

/**
 * lazy images get `sizes="auto"` so the browser sizes from the actual rendered box (covering
 * viewport *and* container queries); the resolved sizes (or `100vw`) trails as a fallback for
 * browsers without `auto` support. eager images can't use `auto`, so they keep their sizes verbatim.
 */
function withAutoSizes(sizes: string | undefined, lazy: boolean): string | undefined {
  if (!lazy) {
    return sizes;
  }

  return sizes ? `auto, ${sizes}` : 'auto, 100vw';
}

/**
 * shared `<picture>` renderer behind `Picture` and `Image`. renders one `<source>` per
 * format plus a fallback `<img>`; the `transparent` flag controls whether the wrapper
 * collapses to `display: contents`.
 */
export const PictureBase = forwardRef<HTMLImageElement, PictureBaseProps>(function PictureBase(props, ref) {
  const {
    src,
    picture: pictureProps,
    priority,
    sizes,
    transparent,
    loading,
    fetchPriority,
    decoding,
    alt,
    ...imgProps
  } = props;

  const resolvedLoading = loading ?? (priority ? 'eager' : 'lazy');
  const resolvedFetchPriority = fetchPriority ?? (priority ? 'high' : undefined);
  const lazy = resolvedLoading === 'lazy';
  const sizesAttr = withAutoSizes(resolveSizes(sizes), lazy);

  return (
    <picture
      data-asset-id={src.id}
      {...pictureProps}
      {...(transparent ? { style: { display: 'contents', ...pictureProps?.style } } : {})}
    >
      {src.sources?.map((source, i) => (
        <source key={i} type={source.type} srcSet={source.srcset} sizes={sizesAttr} />
      ))}
      <img
        loading={resolvedLoading}
        decoding={decoding ?? 'async'}
        {...(resolvedFetchPriority ? { fetchPriority: resolvedFetchPriority } : {})}
        width={src.image?.width}
        height={src.image?.height}
        {...imgProps}
        ref={ref}
        alt={alt}
        src={src.image?.url}
        srcSet={src.image?.srcset}
        sizes={src.image?.srcset ? sizesAttr : undefined}
      />
    </picture>
  );
});
