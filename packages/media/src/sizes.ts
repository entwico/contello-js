/** tailwind's default `min-width` breakpoints (px), keyed by name */
const TW_BREAKPOINTS = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
} as const;

export type TwBreakpoint = keyof typeof TW_BREAKPOINTS;

/** breakpoint names ordered largest `min-width` first — the order `sizes` clauses must be emitted in */
const TW_BREAKPOINTS_DESC = (Object.keys(TW_BREAKPOINTS) as TwBreakpoint[]).toSorted(
  (a, b) => TW_BREAKPOINTS[b] - TW_BREAKPOINTS[a],
);

/** a rendered width per viewport: `number` is CSS px, `string` is a raw CSS size (e.g. `'100vw'`, `'50vw'`) */
export type SizeValue = number | string;

/**
 * responsive sizes keyed by tailwind breakpoint name. `base` (required) is the
 * default clause used below the smallest given breakpoint; each breakpoint key adds
 * a `(min-width: …)` clause. e.g. `{ base: '100vw', md: 896 }` →
 * `"(min-width: 768px) 896px, 100vw"`.
 */
export type SizesMap = { base: SizeValue } & Partial<Record<TwBreakpoint, SizeValue>>;

/** explicit `sizes` input: a raw `sizes` attribute string, or a breakpoint-keyed map */
export type SizesInput = string | SizesMap;

// resolves the `sizes` input to a string: a raw string passes through verbatim, a
// SizesMap serializes to media-query clauses. undefined input → undefined.
export function resolveSizes(sizes: SizesInput | undefined): string | undefined {
  if (sizes === undefined) {
    return undefined;
  }

  if (typeof sizes === 'string') {
    return sizes;
  }

  return sizesMapToString(sizes);
}

function sizeValue(value: SizeValue): string {
  return typeof value === 'number' ? `${value}px` : value;
}

// serializes a SizesMap into a `sizes` attribute: breakpoint clauses largest-first,
// then the required `base` as the trailing default clause.
function sizesMapToString(map: SizesMap): string {
  const parts = TW_BREAKPOINTS_DESC.filter((bp) => map[bp] !== undefined).map(
    (bp) => `(min-width: ${TW_BREAKPOINTS[bp]}px) ${sizeValue(map[bp]!)}`,
  );

  parts.push(sizeValue(map.base));

  return parts.join(', ');
}
