import { type ReactNode, useRef } from 'react';
import { flushSync } from 'react-dom';
import { type Root, createRoot } from 'react-dom/client';
import { type MockInstance, afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { Video } from './Video';
import { useHlsPlayback } from './useHlsPlayback';

const hls = vi.hoisted(() => ({
  loadSource: vi.fn(),
  attachMedia: vi.fn(),
  destroy: vi.fn(),
  isSupported: vi.fn(() => true),
}));

vi.mock('hls.js', () => {
  class Hls {
    static isSupported() {
      return hls.isSupported();
    }

    loadSource(url: string) {
      hls.loadSource(url);
    }

    attachMedia(element: HTMLMediaElement) {
      hls.attachMedia(element);
    }

    destroy() {
      hls.destroy();
    }
  }

  return { default: Hls };
});

const MANIFEST = 'https://cdn.example.com/video.m3u8';
const POSTER = '/i/poster.jpg';

let mounted: { root: Root; container: HTMLElement }[] = [];
let canPlayType: MockInstance<HTMLVideoElement['canPlayType']>;

function mount(node: ReactNode) {
  const container = document.createElement('div');

  document.body.append(container);

  const root = createRoot(container);

  // eslint-disable-next-line @eslint-react/dom-no-flush-sync -- effects must run synchronously for assertions
  flushSync(() => root.render(node));

  mounted.push({ root, container });

  return container;
}

function Harness({ url }: { url: string }) {
  const ref = useRef<HTMLVideoElement | null>(null);

  useHlsPlayback(ref, url);

  // eslint-disable-next-line jsx-a11y/media-has-caption -- bare element under test, no captions needed
  return <video ref={ref} />;
}

beforeEach(() => {
  canPlayType = vi.spyOn(HTMLVideoElement.prototype, 'canPlayType');
  hls.loadSource.mockClear();
  hls.attachMedia.mockClear();
  hls.destroy.mockClear();
  hls.isSupported.mockReset().mockReturnValue(true);
});

afterEach(() => {
  for (const { root, container } of mounted) {
    root.unmount();
    container.remove();
  }

  mounted = [];

  vi.restoreAllMocks();
});

describe('Video', () => {
  test('attaches the manifest via hls.js when native HLS is unavailable', async () => {
    canPlayType.mockReturnValue('');

    const container = mount(<Video src={MANIFEST} poster={POSTER} />);
    const video = container.querySelector('video')!;

    await vi.waitFor(() => expect(hls.attachMedia).toHaveBeenCalledTimes(1));

    expect(hls.loadSource).toHaveBeenCalledWith(MANIFEST);
    expect(hls.attachMedia).toHaveBeenCalledWith(video);
    expect(video.poster).toContain('poster.jpg');
  });

  test('destroys the hls.js instance on unmount', async () => {
    canPlayType.mockReturnValue('');

    mount(<Video src={MANIFEST} poster={POSTER} />);

    await vi.waitFor(() => expect(hls.attachMedia).toHaveBeenCalled());

    const entry = mounted.pop()!;

    entry.root.unmount();
    entry.container.remove();

    expect(hls.destroy).toHaveBeenCalledTimes(1);
  });

  test('uses native playback when the browser supports HLS', async () => {
    canPlayType.mockReturnValue('maybe');

    const container = mount(<Video src={MANIFEST} poster={POSTER} />);
    const video = container.querySelector('video')!;

    await vi.waitFor(() => expect(video.getAttribute('src')).toBe(MANIFEST));

    expect(hls.loadSource).not.toHaveBeenCalled();
  });

  test('does nothing when hls.js reports no support', async () => {
    canPlayType.mockReturnValue('');
    hls.isSupported.mockReturnValue(false);

    mount(<Video src={MANIFEST} poster={POSTER} />);

    await vi.waitFor(() => expect(hls.isSupported).toHaveBeenCalled());

    expect(hls.attachMedia).not.toHaveBeenCalled();
  });

  test('forwards a callback ref and extra props and children to the <video>', () => {
    canPlayType.mockReturnValue('maybe');

    const seen: (HTMLVideoElement | null)[] = [];
    const container = mount(
      <Video src={MANIFEST} poster={POSTER} controls ref={(el) => void seen.push(el)}>
        <track kind="captions" />
      </Video>,
    );
    const video = container.querySelector('video')!;

    expect(seen).toContain(video);
    expect(video.controls).toBe(true);
    expect(video.querySelector('track')).not.toBeNull();
  });

  test('supports an object ref', () => {
    canPlayType.mockReturnValue('maybe');

    const ref = { current: null as HTMLVideoElement | null };
    const container = mount(<Video src={MANIFEST} poster={POSTER} ref={ref} />);

    expect(ref.current).toBe(container.querySelector('video'));
  });
});

describe('useHlsPlayback', () => {
  test('attaches a native source to the video element', async () => {
    canPlayType.mockReturnValue('maybe');

    const container = mount(<Harness url={MANIFEST} />);
    const video = container.querySelector('video')!;

    await vi.waitFor(() => expect(video.getAttribute('src')).toBe(MANIFEST));

    expect(hls.loadSource).not.toHaveBeenCalled();
  });

  test('falls back to hls.js when native playback is unavailable', async () => {
    canPlayType.mockReturnValue('');

    mount(<Harness url={MANIFEST} />);

    await vi.waitFor(() => expect(hls.loadSource).toHaveBeenCalledWith(MANIFEST));
  });
});
