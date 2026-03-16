export const NO_MATCH: unique symbol = Symbol('@contello/store/no-match');

type FlatRef = { _flatId?: string | null };

type MapFn<TResult> = (refs: readonly FlatRef[] | null | undefined) => TResult[];

type Visitors<TFlat extends { __typename: string } & FlatRef, TResult> = {
  [K in TFlat['__typename']]?: (
    component: Extract<TFlat, { __typename: K }>,
    map: MapFn<TResult>,
  ) => TResult | null | undefined | false | 0 | '';
} & {
  [NO_MATCH]?: (component: TFlat) => void;
};

export class ComponentMapper<TFlat extends { __typename: string } & FlatRef, TResult> {
  constructor(private readonly visitors: Visitors<TFlat, TResult>) {}

  map(flat: readonly TFlat[] | null | undefined, refs: readonly FlatRef[] | null | undefined): TResult[] {
    const flatMap = new Map((flat ?? []).map((c) => [c._flatId, c]));

    return this.resolveRefs(flatMap, refs);
  }

  private resolveRefs(
    flatMap: Map<string | null | undefined, TFlat>,
    refs: readonly FlatRef[] | null | undefined,
  ): TResult[] {
    return (refs ?? []).flatMap((ref) => {
      if (!ref._flatId) return [];

      const component = flatMap.get(ref._flatId);

      if (!component) return [];

      const visitor = this.visitors[component.__typename as keyof typeof this.visitors] as
        | ((c: TFlat, m: MapFn<TResult>) => TResult | null | undefined | false | 0 | '')
        | undefined;

      if (!visitor) {
        this.visitors[NO_MATCH]?.(component);

        return [];
      }

      const result = visitor(component, (nestedRefs) => this.resolveRefs(flatMap, nestedRefs));

      return result ? [result] : [];
    });
  }
}
