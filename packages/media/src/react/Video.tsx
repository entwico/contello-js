import { type ComponentPropsWithoutRef, forwardRef, useCallback, useRef } from 'react';

import { useHlsPlayback } from './useHlsPlayback';

type VideoSpread = Omit<ComponentPropsWithoutRef<'video'>, 'src' | 'poster'>;

export type VideoProps = {
  /** pre-resolved HLS manifest URL — obtain via `mediaResolver.video.m3u8(source)` */
  src: string;
  /** pre-resolved poster URL — obtain via `mediaResolver.image.url(source, 'videoPoster')` */
  poster: string;
} & VideoSpread;

/**
 * renders a `<video>` wired up to HLS delivery. native HLS where available
 * (Safari/iOS), hls.js fallback everywhere else. top-level ref is forwarded
 * to the underlying `<video>`; an internal ref stays alive for hls.js
 * attachment.
 *
 * `src` is a pre-resolved HLS manifest URL; `poster` is a pre-resolved image
 * URL. use `mediaResolver.video.m3u8(source)` and
 * `mediaResolver.image.url(source, 'videoPoster')` to produce them at the
 * mapping layer.
 */
export const Video = forwardRef<HTMLVideoElement, VideoProps>(function Video(props, forwardedRef) {
  const { src, poster, children, ...rest } = props;

  const internalRef = useRef<HTMLVideoElement | null>(null);

  useHlsPlayback(internalRef, src);

  const setRef = useCallback(
    (el: HTMLVideoElement | null) => {
      internalRef.current = el;

      if (typeof forwardedRef === 'function') {
        forwardedRef(el);
      } else if (forwardedRef) {
        forwardedRef.current = el;
      }
    },
    [forwardedRef],
  );

  return (
    <video ref={setRef} poster={poster} {...rest}>
      {children}
    </video>
  );
});
