import { describe, it, expect, vi } from 'vitest';
import { createFixedLoop } from './loop.js';

describe('createFixedLoop', () => {
  it('runs one update per whole step and carries the remainder as alpha', () => {
    const update = vi.fn();
    const render = vi.fn();
    const loop = createFixedLoop({ stepMs: 10, update, render });

    loop.advance(16);

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(10);
    // 6ms left over -> alpha 0.6
    expect(render).toHaveBeenCalledWith(0.6);
  });

  it('accumulates across frames (sub-step frames eventually trigger an update)', () => {
    const update = vi.fn();
    const loop = createFixedLoop({ stepMs: 10, update });

    loop.advance(6); // 6 < 10 -> no update
    expect(update).toHaveBeenCalledTimes(0);
    loop.advance(6); // 12 -> one update, 2 left
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('does nothing on zero/negative elapsed but still renders', () => {
    const update = vi.fn();
    const render = vi.fn();
    const loop = createFixedLoop({ stepMs: 10, update, render });

    loop.advance(0);
    expect(update).not.toHaveBeenCalled();
    expect(render).toHaveBeenCalledWith(0);
  });

  it('clamps to maxSubSteps on a long stall (no spiral of death)', () => {
    const update = vi.fn();
    const loop = createFixedLoop({ stepMs: 10, maxSubSteps: 5, update });

    loop.advance(1000); // would be 100 steps; clamp at 5
    expect(update).toHaveBeenCalledTimes(5);

    // Backlog was dropped, so the next frame starts fresh.
    update.mockClear();
    loop.advance(10);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('reset() clears the accumulator', () => {
    const update = vi.fn();
    const loop = createFixedLoop({ stepMs: 10, update });
    loop.advance(8);
    loop.reset();
    loop.advance(8); // 8 again (not 16) -> still no update
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects a non-positive step', () => {
    expect(() => createFixedLoop({ stepMs: 0, update: () => {} })).toThrow();
  });
});
