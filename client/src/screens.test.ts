import { describe, it, expect, vi } from 'vitest';
import { createScreenController } from './screens.js';

describe('createScreenController', () => {
  it('starts on the landing screen', () => {
    expect(createScreenController().current).toBe('landing');
  });

  it('moves to the arena on join and notifies once', () => {
    const onChange = vi.fn();
    const c = createScreenController(onChange);
    expect(c.join()).toBe('arena');
    expect(c.current).toBe('arena');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('arena');
  });

  it('is idempotent — a second join does not re-fire onChange', () => {
    const onChange = vi.fn();
    const c = createScreenController(onChange);
    c.join();
    c.join();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('moves arena -> resolution on resolve, and back to arena on next', () => {
    const onChange = vi.fn();
    const c = createScreenController(onChange);
    c.join();
    expect(c.resolve()).toBe('resolution');
    expect(c.current).toBe('resolution');
    expect(c.next()).toBe('arena');
    expect(onChange).toHaveBeenLastCalledWith('arena');
  });

  it('ignores resolve() unless in the arena', () => {
    const c = createScreenController();
    expect(c.resolve()).toBe('landing'); // still on landing
  });

  it('ignores next() unless on the resolution screen', () => {
    const c = createScreenController();
    c.join();
    expect(c.next()).toBe('arena'); // no-op from the arena
  });
});
