import { describe, it, expect } from 'vitest';
import { createInputBuffer } from './input.js';

describe('createInputBuffer', () => {
  it('rejects a non-positive cap', () => {
    expect(() => createInputBuffer({ cap: 0 })).toThrow();
  });

  it('drains buffered inputs in FIFO arrival order', () => {
    const buffer = createInputBuffer<number>();
    buffer.push(1);
    buffer.push(2);
    buffer.push(3);
    expect(buffer.drain()).toEqual([1, 2, 3]);
  });

  it('empties the buffer once drained', () => {
    const buffer = createInputBuffer<number>();
    buffer.push(1);
    buffer.drain();
    expect(buffer.size()).toBe(0);
    expect(buffer.drain()).toEqual([]);
  });

  it('drops the oldest inputs when pushed past the cap', () => {
    const buffer = createInputBuffer<number>({ cap: 3 });
    for (const n of [1, 2, 3, 4, 5]) buffer.push(n);
    expect(buffer.size()).toBe(3);
    // Newest three survive; the oldest two are discarded.
    expect(buffer.drain()).toEqual([3, 4, 5]);
  });

  it('reports the current size without consuming', () => {
    const buffer = createInputBuffer<string>();
    buffer.push('a');
    buffer.push('b');
    expect(buffer.size()).toBe(2);
    expect(buffer.size()).toBe(2);
  });

  it('clears all buffered inputs', () => {
    const buffer = createInputBuffer<number>();
    buffer.push(1);
    buffer.push(2);
    buffer.clear();
    expect(buffer.size()).toBe(0);
    expect(buffer.drain()).toEqual([]);
  });
});
