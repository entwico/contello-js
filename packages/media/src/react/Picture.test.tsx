import { describe, expect, test } from 'vitest';

import type { ImageSource } from '../types';
import { Picture, type PictureProps } from './Picture';

const src: ImageSource = {
  id: 'asset-1',
  image: {
    url: '/i/main.jpg',
    srcset: '/i/main-400.jpg 400w, /i/main-800.jpg 800w',
    width: 800,
    height: 600,
  },
  sources: [{ type: 'image/avif', srcset: '/i/main-400.avif 400w, /i/main-800.avif 800w' }],
};

// picture forwards to PictureBase; call one level down to reach the rendered markup
function render(props: Partial<PictureProps>) {
  const element = Picture({ src, alt: '', ...props });
  const picture = element.type(element.props);
  const [sources, img] = picture.props.children;

  return { picture, sources, img };
}

describe('Picture', () => {
  test('renders a <picture> with one <source> per format and a fallback <img>', () => {
    const { picture, sources, img } = render({ alt: 'hero' });

    expect(picture.type).toBe('picture');
    expect(picture.props['data-asset-id']).toBe('asset-1');
    expect(sources.map((s: { props: { type: string } }) => s.props.type)).toEqual(['image/avif']);
    expect(sources[0].props.srcSet).toBe(src.sources?.[0]?.srcset);
    expect(img.props.src).toBe('/i/main.jpg');
    expect(img.props.srcSet).toBe(src.image?.srcset);
    expect(img.props.alt).toBe('hero');
    expect(img.props.width).toBe(800);
    expect(img.props.height).toBe(600);
  });

  test('lazy by default', () => {
    const { img } = render({});

    expect(img.props.loading).toBe('lazy');
    expect(img.props.fetchPriority).toBeUndefined();
  });

  test('priority sets eager loading and high fetch priority', () => {
    const { img } = render({ priority: true });

    expect(img.props.loading).toBe('eager');
    expect(img.props.fetchPriority).toBe('high');
  });

  test('does not unwrap the <picture> wrapper', () => {
    const { picture } = render({});

    expect(picture.props.style).toBeUndefined();
  });

  test('the picture prop targets the outer <picture>', () => {
    const { picture } = render({ picture: { className: 'wrap' } });

    expect(picture.props.className).toBe('wrap');
  });
});
