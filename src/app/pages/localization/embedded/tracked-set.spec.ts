import { TrackedSet } from './tracked-set';

describe('TrackedSet', () => {
  it('behaves like a Set (size, has, spread, forEach, iteration order)', () => {
    const s = new TrackedSet<string>();
    s.add('a'); s.add('b'); s.add('a');
    expect(s.size).toBe(2);
    expect(s.has('a')).toBe(true);
    expect([...s]).toEqual(['a', 'b']);
    const seen: string[] = [];
    s.forEach((v) => seen.push(v));
    expect(seen).toEqual(['a', 'b']);
    expect(s instanceof Set).toBe(true);
  });

  it('bumps rev only when the content really changes', () => {
    const s = new TrackedSet<number>();
    expect(s.rev()).toBe(0);
    s.add(1);
    expect(s.rev()).toBe(1);
    s.add(1); // already there
    expect(s.rev()).toBe(1);
    s.delete(2); // not there
    expect(s.rev()).toBe(1);
    s.delete(1);
    expect(s.rev()).toBe(2);
    s.clear(); // already empty
    expect(s.rev()).toBe(2);
    s.add(5); s.add(6);
    s.clear();
    expect(s.rev()).toBe(5);
    expect(s.size).toBe(0);
  });

  it('is safe to construct from an iterable (Set calls add() before the fields exist)', () => {
    const s = new TrackedSet<string>(['x', 'y']);
    expect(s.size).toBe(2);
    expect(s.rev()).toBe(0);
    s.add('z');
    expect(s.rev()).toBe(1);
  });

  it('returns the same values as Set from add/delete', () => {
    const s = new TrackedSet<string>();
    expect(s.add('a')).toBe(s);
    expect(s.delete('a')).toBe(true);
    expect(s.delete('a')).toBe(false);
  });
});
