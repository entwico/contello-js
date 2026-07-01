import { PictureBase, type PictureBaseProps } from './PictureBase';

export type ImageProps = Omit<PictureBaseProps, 'unwrap' | 'picture'>;

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
 * `sizes="auto"` and may omit `sizes` (falling back to `auto, 100vw`); priority images should
 * declare `sizes` since they can't use automatic sizing. all other top-level props forward to
 * the `<img>`.
 */
export function Image(props: ImageProps) {
  return <PictureBase {...props} unwrap />;
}
