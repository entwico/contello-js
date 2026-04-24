import { type ComponentPropsWithRef, type ComponentPropsWithoutRef, forwardRef } from 'react';

import type { PictureSource } from '../types';

type ImgSpread = Omit<ComponentPropsWithoutRef<'img'>, 'src' | 'srcSet' | 'sizes'>;

export type PictureProps = {
  /** pre-resolved picture data — obtain via `mediaResolver.picture.src(source, options?)` */
  src: PictureSource;
  /** attributes for the outer `<picture>` element (className, style, ref, data-*, aria-*, event handlers) */
  picture?: ComponentPropsWithRef<'picture'> | undefined;
  /** shortcut for LCP images: sets `loading="eager"` + `fetchPriority="high"`. explicit `loading` / `fetchPriority` props still win. */
  priority?: boolean | undefined;
} & ImgSpread;

/**
 * renders a `<picture>` with one `<source>` per format (using `srcset`+`sizes`
 * so the browser picks the right width from the viewport and DPR) and a
 * fallback `<img>`.
 *
 * requires a pre-computed `PictureSource` — use `mediaResolver.picture.src()`
 * at the mapping layer so hydration payloads carry only the resolved data.
 *
 * top-level props forward to the `<img>` (ref, className, style, alt, width,
 * height, loading, decoding, fetchPriority, ARIA, event handlers). the
 * `picture={{...}}` prop targets the outer `<picture>` element.
 */
export const Picture = forwardRef<HTMLImageElement, PictureProps>(function Picture(props, ref) {
  const { src, picture: pictureProps, priority, loading, fetchPriority, decoding, ...imgProps } = props;

  const resolvedLoading = loading ?? (priority ? 'eager' : 'lazy');
  const resolvedFetchPriority = fetchPriority ?? (priority ? 'high' : undefined);

  return (
    <picture data-asset-id={src.id} {...pictureProps}>
      {src.sources?.map((source, i) => (
        <source key={i} type={source.type} srcSet={source.srcset} sizes={source.sizes} />
      ))}
      <img
        loading={resolvedLoading}
        decoding={decoding ?? 'async'}
        {...(resolvedFetchPriority ? { fetchPriority: resolvedFetchPriority } : {})}
        width={src.image?.width}
        height={src.image?.height}
        {...imgProps}
        ref={ref}
        src={src.image?.url}
        srcSet={src.image?.srcset}
        sizes={src.image?.sizes}
      />
    </picture>
  );
});
