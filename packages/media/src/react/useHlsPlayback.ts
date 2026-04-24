import { type RefObject, useEffect } from 'react';

/**
 * attaches an HLS source (`.m3u8`) to a `<video>` element, preferring native
 * playback where available (Safari/iOS) and falling back to hls.js. hls.js is
 * dynamically imported — add it as a dependency only if the app uses this hook.
 *
 * intended for building custom video UIs around contello's HLS delivery without
 * inheriting the `<Video>` component's layout opinions.
 */
export function useHlsPlayback(ref: RefObject<HTMLVideoElement | null>, url: string): void {
  useEffect(() => {
    let cancelled = false;
    let hlsInstance: { destroy(): void } | undefined;

    (async () => {
      if (typeof window === 'undefined' || !ref.current) {
        return;
      }

      const videoElement = ref.current;

      if (videoElement.canPlayType('application/vnd.apple.mpegurl')) {
        videoElement.src = url;

        return;
      }

      const { default: Hls } = await import('hls.js');

      if (cancelled || !Hls.isSupported()) {
        return;
      }

      const hls = new Hls();

      hls.loadSource(url);
      hls.attachMedia(videoElement);
      hlsInstance = hls;
    })();

    return () => {
      cancelled = true;
      hlsInstance?.destroy();
    };
  }, [ref, url]);
}
