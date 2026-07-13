import { describe, expect, test } from 'vitest';

import type { ImageSource } from '../types';
import { PictureBase, type PictureBaseProps } from './PictureBase';

const src: ImageSource = {
  id: 'asset-1',
  image: {
    url: '/i/main.jpg',
    srcset: '/i/main-400.jpg 400w, /i/main-800.jpg 800w',
  },
  sources: [{ type: 'image/avif', srcset: '/i/main-400.avif 400w, /i/main-800.avif 800w' }],
};

function renderedSizes(props: Partial<PictureBaseProps>) {
  const picture = PictureBase({ src, alt: '', ...props });
  const [sources, img] = picture.props.children;

  return {
    source: sources?.[0]?.props.sizes as string | undefined,
    img: img.props.sizes as string | undefined,
  };
}

describe('PictureBase sizes', () => {
  test('lazy images use explicit sizes verbatim', () => {
    expect(renderedSizes({ sizes: '600px' })).toEqual({ source: '600px', img: '600px' });
  });

  test('lazy images without sizes fall back to auto, 100vw', () => {
    expect(renderedSizes({})).toEqual({ source: 'auto, 100vw', img: 'auto, 100vw' });
  });

  test('eager images use explicit sizes verbatim', () => {
    expect(renderedSizes({ priority: true, sizes: '600px' })).toEqual({ source: '600px', img: '600px' });
  });

  test('eager images without sizes get no sizes attribute', () => {
    expect(renderedSizes({ priority: true })).toEqual({ source: undefined, img: undefined });
  });

  test('sizes maps resolve before being applied', () => {
    expect(renderedSizes({ sizes: { base: '100vw', md: '50vw' } }).img).toBe('(min-width: 768px) 50vw, 100vw');
  });
});

describe('PictureBase dev collapse check', () => {
  function renderedImgRef(props: Partial<PictureBaseProps>) {
    const picture = PictureBase({ src, alt: '', ...props });
    const [, img] = picture.props.children;

    return img.props.ref as unknown;
  }

  test('the img ref is wrapped only when the automatic sizes fallback applies', () => {
    expect(renderedImgRef({})).toBeTypeOf('function');
    expect(renderedImgRef({ sizes: '600px' })).toBeUndefined();
    expect(renderedImgRef({ priority: true })).toBeUndefined();
  });

  test('the wrapped ref still forwards to the caller ref', () => {
    const seen: unknown[] = [];
    const wrapped = renderedImgRef({ ref: (node: unknown) => void seen.push(node) }) as (node: unknown) => void;

    wrapped(null);

    expect(seen).toEqual([null]);
  });
});
