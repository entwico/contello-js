import { PictureBase, type PictureBaseProps } from './PictureBase';

export type PictureProps = Omit<PictureBaseProps, 'unwrap'>;

/**
 * renders a `<picture>` with one `<source>` per format (using `srcset`+`sizes`
 * so the browser picks the right width from the viewport and DPR) and a
 * fallback `<img>`.
 *
 * requires a pre-computed `ImageSource` — use `mediaResolver.image.source()`
 * at the mapping layer so hydration payloads carry only the resolved data.
 *
 * lazy images get `sizes="auto"` (the browser sizes from the actual rendered box) and may
 * omit `sizes` (falling back to `auto, 100vw`); priority images should declare it. other top-level
 * props forward to the `<img>` (ref, className, style, alt, width, height, loading, decoding,
 * fetchPriority, ARIA, event handlers); the `picture={{...}}` prop targets the outer `<picture>`.
 *
 * for flex/grid slots where the `<picture>` wrapper interferes with layout, use
 * `Image` instead — it renders the same markup with an unwrapped wrapper.
 */
export function Picture(props: PictureProps) {
  return <PictureBase {...props} />;
}
