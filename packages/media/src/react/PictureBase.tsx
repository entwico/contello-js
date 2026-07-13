import type { ComponentPropsWithRef } from 'react';

import { type SizesInput, resolveSizes } from '../sizes';
import type { DeepReadonly, ImageSource } from '../types';

export type ImgSpread = Omit<ComponentPropsWithRef<'img'>, 'src' | 'srcSet' | 'sizes'>;

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
  /**
   * responsive sizes — a raw `sizes` string or a breakpoint-keyed `SizesMap`. when set, it is
   * used verbatim. should be set for priority (eager) images, which can't use automatic sizing;
   * lazy images may omit it (they fall back to `auto, 100vw`).
   *
   * **the `auto` fallback requires the `<img>` to have a definite CSS width** independent of the
   * image itself (e.g. `w-full`, a fixed width, a sized flex/grid track). with an auto-width
   * image the browser sizes the image from its own layout box, picks the smallest srcset
   * candidate, and the image collapses to 0×0 permanently. for "natural size, capped" images
   * always pass explicit `sizes`.
   */
  sizes?: SizesInput | undefined;
  /**
   * render the `<picture>` as `display: contents` so its `<img>` participates
   * directly in the parent flex/grid layout (the wrapper leaves the box tree).
   */
  unwrap?: boolean | undefined;
} & ImgSpread;

/**
 * explicit `sizes` always wins verbatim — prepending `auto` would make supporting browsers
 * ignore the caller's list entirely. only lazy images with no `sizes` fall back to
 * `auto, 100vw`: `auto` sizes from the actual rendered box (covering viewport *and* container
 * queries), `100vw` trails for browsers without `auto` support. eager images can't use `auto`.
 */
function defaultSizes(sizes: string | undefined, lazy: boolean): string | undefined {
  if (sizes !== undefined || !lazy) {
    return sizes;
  }

  return 'auto, 100vw';
}

/**
 * shared `<picture>` renderer behind `Picture` and `Image`. renders one `<source>` per
 * format plus a fallback `<img>`; the `unwrap` flag controls whether the wrapper
 * collapses to `display: contents`.
 */
export function PictureBase(props: PictureBaseProps) {
  const {
    src,
    picture: pictureProps,
    priority,
    sizes,
    unwrap,
    loading,
    fetchPriority,
    decoding,
    alt,
    ref,
    ...imgProps
  } = props;

  const resolvedLoading = loading ?? (priority ? 'eager' : 'lazy');
  const resolvedFetchPriority = fetchPriority ?? (priority ? 'high' : undefined);
  const lazy = resolvedLoading === 'lazy';
  const sizesAttr = defaultSizes(resolveSizes(sizes), lazy);

  return (
    <picture
      data-asset-id={src.id}
      {...pictureProps}
      {...(unwrap ? { style: { display: 'contents', ...pictureProps?.style } } : {})}
    >
      {src.sources?.map((source) => (
        <source key={source.type} type={source.type} srcSet={source.srcset} sizes={sizesAttr} />
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
}
