import { describe, expect, test } from 'vitest';

import { createWriteBuffer } from './write-buffer';

type Item = { id: string; value: number };

describe('createWriteBuffer', () => {
  test('answers a requested id from what was parked for it', () => {
    const buffer = createWriteBuffer<Item>();

    buffer.park('a', { id: 'a', value: 1 });

    expect(buffer.take(['a', 'b'])).toEqual({ written: [{ id: 'a', value: 1 }], missing: ['b'] });
  });

  test('serves a parked entity once — the next request must fetch it', () => {
    const buffer = createWriteBuffer<Item>();

    buffer.park('a', { id: 'a', value: 1 });
    buffer.take(['a']);

    expect(buffer.take(['a'])).toEqual({ written: [], missing: ['a'] });
  });

  test('release drops a parked entity a refresh never consumed', () => {
    const buffer = createWriteBuffer<Item>();

    buffer.park('a', { id: 'a', value: 1 });
    buffer.release(['a']);

    expect(buffer.take(['a'])).toEqual({ written: [], missing: ['a'] });
  });

  test('clear drops everything, as a full fetch is authoritative for every id', () => {
    const buffer = createWriteBuffer<Item>();

    buffer.park('a', { id: 'a', value: 1 });
    buffer.park('b', { id: 'b', value: 2 });
    buffer.clear();

    expect(buffer.take(['a', 'b'])).toEqual({ written: [], missing: ['a', 'b'] });
  });
});

describe('createWriteBuffer upstream precedence', () => {
  test('drops what is already parked for an id upstream is refetching', () => {
    const buffer = createWriteBuffer<Item>();

    buffer.park('a', { id: 'a', value: 1 });
    buffer.awaitingUpstream(['a']);

    expect(buffer.take(['a'])).toEqual({ written: [], missing: ['a'] });
  });

  test('refuses to park an id whose upstream refetch is still outstanding', () => {
    const buffer = createWriteBuffer<Item>();

    buffer.awaitingUpstream(['a']);
    buffer.park('a', { id: 'a', value: 1 });

    expect(buffer.take(['a'])).toEqual({ written: [], missing: ['a'] });
  });

  test('parks again once the upstream refetch has settled', () => {
    const buffer = createWriteBuffer<Item>();
    const settled = buffer.awaitingUpstream(['a']);

    settled();
    buffer.park('a', { id: 'a', value: 1 });

    expect(buffer.take(['a'])).toEqual({ written: [{ id: 'a', value: 1 }], missing: [] });
  });

  test('stays closed until the last of several overlapping refetches settles', () => {
    const buffer = createWriteBuffer<Item>();
    const first = buffer.awaitingUpstream(['a']);
    const second = buffer.awaitingUpstream(['a']);

    first();
    buffer.park('a', { id: 'a', value: 1 });

    expect(buffer.take(['a'])).toEqual({ written: [], missing: ['a'] });

    second();
    buffer.park('a', { id: 'a', value: 1 });

    expect(buffer.take(['a'])).toEqual({ written: [{ id: 'a', value: 1 }], missing: [] });
  });

  test('leaves ids no upstream refetch named alone', () => {
    const buffer = createWriteBuffer<Item>();

    buffer.awaitingUpstream(['a']);
    buffer.park('b', { id: 'b', value: 2 });

    expect(buffer.take(['b'])).toEqual({ written: [{ id: 'b', value: 2 }], missing: [] });
  });
});
