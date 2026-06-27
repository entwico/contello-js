import { forwardRef } from 'react';

import { PictureBase, type PictureBaseProps, type SizesByPriority } from './PictureBase';

export type ImageProps = Omit<PictureBaseProps, 'transparent' | 'picture' | 'priority' | 'sizes'> & SizesByPriority;

/**
 * an `<img>`-shaped view over the same `<picture>` machinery as `Picture`: it still
 * renders `<source>` entries for AVIF/WebP format negotiation, but the wrapper is
 * `display: contents` so the `<img>` participates directly in the parent flex/grid
 * layout. there is no `picture` prop — the wrapper is an invisible implementation detail.
 *
 * use this as the default for images inside flex/grid slots; reach for `Picture` only
 * when you need to style the wrapper or use art-directed `<source media>` entries.
 *
 * requires a pre-computed `ImageSource` (`mediaResolver.image.source()`). lazy images get
 * `sizes="auto"` and may omit `sizes` (falling back to `auto, 100vw`); priority images require
 * it. all other top-level props forward to the `<img>`.
 */
export const Image = forwardRef<HTMLImageElement, ImageProps>(function Image(props, ref) {
  return <PictureBase {...props} transparent ref={ref} />;
});
