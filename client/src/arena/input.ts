/**
 * Bounded input buffer (P0-C-3 / OOM-19).
 *
 * Pointer/touch events arrive asynchronously and in bursts, but the contribution mechanic is
 * consumed by the fixed-timestep loop (`loop.ts`) exactly once per simulation step. This buffer
 * decouples the two: DOM handlers `push` raw inputs as they happen, the fixed step `drain`s them
 * in arrival order. Consumption is therefore deterministic (the basis for the strike/combo maths in
 * OOM-19/22) and no input is silently dropped between steps.
 *
 * A hard `cap` mirrors the anti-"spiral of death" discipline in `loop.ts`: a long stall or a
 * pathological event flood can never grow the queue without bound — the oldest inputs are discarded
 * so the newest (most relevant) survive. Pure (no DOM), so it is fully unit-testable in Node.
 */

export interface InputBuffer<T> {
  /** Enqueue one raw input. Oldest entries are dropped once `cap` is exceeded. */
  push: (item: T) => void;
  /** Remove and return all buffered inputs in arrival (FIFO) order. */
  drain: () => T[];
  /** Number of inputs currently buffered. */
  size: () => number;
  /** Discard all buffered inputs (e.g. on pause/reset). */
  clear: () => void;
}

export interface InputBufferOptions {
  /** Maximum inputs retained; pushing past it drops the oldest. Default 32. */
  cap?: number;
}

export function createInputBuffer<T>(options: InputBufferOptions = {}): InputBuffer<T> {
  const cap = options.cap ?? 32;
  if (cap <= 0) throw new Error('cap must be > 0');

  let queue: T[] = [];

  return {
    push(item: T): void {
      queue.push(item);
      // Keep the newest `cap` entries; a burst never grows the queue without bound.
      if (queue.length > cap) queue = queue.slice(queue.length - cap);
    },
    drain(): T[] {
      const drained = queue;
      queue = [];
      return drained;
    },
    size(): number {
      return queue.length;
    },
    clear(): void {
      queue = [];
    },
  };
}
