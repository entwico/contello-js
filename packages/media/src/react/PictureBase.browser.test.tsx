import type { ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { type Root, createRoot } from 'react-dom/client';
import { type MockInstance, afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { ImageSource } from '../types';
import { Image } from './Image';

// a loadable image is required: a failing src makes chrome swap in its broken-image
// representation at the 300×150 default object size, which un-collapses the layout
const GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

const src: ImageSource = {
  id: 'asset-1',
  image: {
    url: GIF,
    srcset: `${GIF} 400w, ${GIF} 800w`,
  },
};

const CHECK_DELAY = 1000;

let warnSpy: MockInstance;
let mounted: { root: Root; container: HTMLElement }[] = [];

function mount(node: ReactNode) {
  const container = document.createElement('div');

  document.body.append(container);

  const root = createRoot(container);

  // eslint-disable-next-line @eslint-react/dom-no-flush-sync -- tests need refs attached synchronously
  flushSync(() => root.render(node));

  mounted.push({ root, container });

  return container;
}

function collapseWarnings() {
  return warnSpy.mock.calls.filter(
    ([message]) => typeof message === 'string' && message.startsWith('[@contello/media]'),
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  for (const { root, container } of mounted) {
    root.unmount();
    container.remove();
  }

  mounted = [];

  warnSpy.mockRestore();
});

describe('sizes auto collapse warning', () => {
  test('warns when the auto-fallback image renders at 0 width', async () => {
    const container = mount(
      <div style={{ width: 0 }}>
        <Image src={src} alt="" style={{ width: '100%' }} />
      </div>,
    );

    expect(container.querySelector('img')?.getBoundingClientRect().width).toBe(0);

    await vi.waitFor(
      () => {
        expect(collapseWarnings()).toHaveLength(1);
      },
      { timeout: CHECK_DELAY + 2000, interval: 50 },
    );

    expect(collapseWarnings()[0]?.[0]).toContain('"asset-1"');
  });

  test('does not warn when the img has a definite CSS width', async () => {
    const container = mount(<Image src={src} alt="" style={{ width: 240 }} />);

    expect(container.querySelector('img')?.getBoundingClientRect().width).toBe(240);

    await sleep(CHECK_DELAY + 300);

    expect(collapseWarnings()).toHaveLength(0);
  });

  test('does not warn for a collapsed image with explicit sizes', async () => {
    mount(<Image src={src} alt="" sizes="240px" />);

    await sleep(CHECK_DELAY + 300);

    expect(collapseWarnings()).toHaveLength(0);
  });

  test('does not warn for a hidden image', async () => {
    mount(
      <div style={{ display: 'none' }}>
        <Image src={src} alt="" />
      </div>,
    );

    await sleep(CHECK_DELAY + 300);

    expect(collapseWarnings()).toHaveLength(0);
  });

  test('does not warn for a priority image', async () => {
    mount(<Image src={src} alt="" priority />);

    await sleep(CHECK_DELAY + 300);

    expect(collapseWarnings()).toHaveLength(0);
  });
});
