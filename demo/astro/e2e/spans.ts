import type { CollectedSpan } from './otlp-collector';

export const SPAN_KIND_SERVER = 2;

/** span end may be exported a tick before a child's end lands on the wire */
const CONTAINMENT_EPSILON_MS = 5;

export function traceOf(spans: CollectedSpan[], traceId: string): CollectedSpan[] {
  return spans.filter((s) => s.traceId === traceId);
}

export function childrenOf(spans: CollectedSpan[], parent: CollectedSpan): CollectedSpan[] {
  return spans.filter((s) => s.parentSpanId === parent.spanId);
}

export function descendantsOf(spans: CollectedSpan[], parent: CollectedSpan): CollectedSpan[] {
  const result: CollectedSpan[] = [];
  const queue = [parent];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const children = childrenOf(spans, current);

    result.push(...children);
    queue.push(...children);
  }

  return result;
}

/** picks the SERVER span for a given url.path once its whole trace is exported */
export function serverSpanFor(
  path: string,
  seenSpanIds?: ReadonlySet<string> | undefined,
): (spans: CollectedSpan[]) => CollectedSpan | undefined {
  return (spans) =>
    spans.find(
      (s) =>
        s.kind === SPAN_KIND_SERVER && s.attributes['url.path'] === path && s.endMs > 0 && !seenSpanIds?.has(s.spanId),
    );
}

export type TraceProblem = { traceId: string; span: string; problem: string };

/**
 * Structural invariants every exported trace must satisfy:
 * - no dangling parents: a span's parent must exist in the same trace
 *   (all spans here come from one process, so nothing legitimately points outside)
 * - no span starts before its parent (causality)
 * - every span lies within its trace root's bounds (small epsilon); direct parent
 *   containment is deliberately NOT required — with streaming SSR, component-level
 *   fetches outlive the middleware span that spawned them, but never the root
 * - every SERVER span carries a ttfb attribute and exactly one response:first-byte child
 */
export function findTraceProblems(spans: CollectedSpan[]): TraceProblem[] {
  const problems: TraceProblem[] = [];
  const byId = new Map(spans.map((s) => [s.spanId, s]));
  const rootByTrace = new Map<string, CollectedSpan>();

  for (const span of spans) {
    if (!span.parentSpanId) {
      rootByTrace.set(span.traceId, span);
    }
  }

  for (const span of spans) {
    if (span.parentSpanId) {
      const parent = byId.get(span.parentSpanId);

      if (!parent) {
        problems.push({ traceId: span.traceId, span: span.name, problem: `dangling parent ${span.parentSpanId}` });

        continue;
      }

      if (parent.traceId !== span.traceId) {
        problems.push({ traceId: span.traceId, span: span.name, problem: 'parent in different trace' });
      }

      if (span.startMs < parent.startMs - CONTAINMENT_EPSILON_MS) {
        problems.push({ traceId: span.traceId, span: span.name, problem: 'starts before its parent' });
      }

      const root = rootByTrace.get(span.traceId);

      if (root && span.endMs > root.endMs + CONTAINMENT_EPSILON_MS) {
        problems.push({ traceId: span.traceId, span: span.name, problem: `ends after trace root ${root.name}` });
      }
    }

    if (span.kind === SPAN_KIND_SERVER) {
      if (typeof span.attributes['ttfb'] !== 'number') {
        problems.push({ traceId: span.traceId, span: span.name, problem: 'server span without ttfb attribute' });
      }

      const firstByte = spans.filter((s) => s.parentSpanId === span.spanId && s.name === 'response:first-byte');

      if (firstByte.length !== 1) {
        problems.push({
          traceId: span.traceId,
          span: span.name,
          problem: `expected 1 response:first-byte child, found ${firstByte.length}`,
        });
      }
    }
  }

  return problems;
}
