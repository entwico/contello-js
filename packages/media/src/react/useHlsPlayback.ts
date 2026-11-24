import type { HlsConfig } from 'hls.js';
import { type RefObject, useEffect, useRef } from 'react';

/** hls.js settings, merged over the defaults of the hook */
export type HlsPlaybackConfig = Partial<HlsConfig>;

// the bandwidth test downloads the first fragment only to measure speed and discards it,
// so a start on the lowest level requests the init segment and first fragment twice
const DEFAULT_CONFIG: HlsPlaybackConfig = { capLevelToPlayerSize: true, testBandwidth: false };

/**
 * attaches an HLS source (`.m3u8`) to a `<video>` element, preferring native
 * playback where available (Safari/iOS) and falling back to hls.js. hls.js is
 * dynamically imported — add it as a dependency only if the app uses this hook.
 *
 * intended for building custom video UIs around contello's HLS delivery without
 * inheriting the `<Video>` component's layout opinions.
 *
 * `config` overrides the hls.js defaults of the hook (level capped to the player
 * size, no start-up bandwidth test). it is read when the player is created — a
 * later change does not recreate the player.
 */
export function useHlsPlayback(
  ref: RefObject<HTMLVideoElement | null>,
  url: string,
  config?: HlsPlaybackConfig | undefined,
): void {
  const configRef = useRef(config);

  useEffect(() => {
    configRef.current = config;
  });

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

      const hls = new Hls({ ...DEFAULT_CONFIG, ...configRef.current });

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
