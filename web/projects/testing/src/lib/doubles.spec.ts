import { describe, expect, it } from 'vitest';
import { idSequence, manualClock, manualFrames, manualTimer } from './doubles';

describe('manualClock', () => {
  it('stands where it was put, and moves only when it is told to', () => {
    const clock = manualClock(100);

    expect(clock.now()).toBe(100);
    expect(clock.now()).toBe(100);
    clock.advance(50);
    expect(clock.now()).toBe(150);
    clock.set(7);
    expect(clock.now()).toBe(7);
  });

  it('starts at a time that is not 0, so that a spec cannot mistake a time that was set for one that was not', () => {
    expect(manualClock().now()).toBeGreaterThan(0);
  });
});

describe('idSequence', () => {
  it('counts up from 1, after its prefix', () => {
    const next = idSequence();

    expect([next(), next(), next()]).toEqual(['id1', 'id2', 'id3']);
    expect(idSequence('canvas-')()).toBe('canvas-1');
  });

  it('is its own sequence for each', () => {
    const [a, b] = [idSequence('x'), idSequence('x')];

    a();
    a();
    expect(b()).toBe('x1');
  });
});

describe('manualTimer', () => {
  it('runs a timer when time reaches it, and not before', () => {
    const timer = manualTimer();
    const ran: string[] = [];
    timer.set(() => ran.push('a'), 100);

    timer.advance(99);
    expect(ran).toEqual([]);
    expect(timer.pending).toBe(1);
    timer.advance(1);
    expect(ran).toEqual(['a']);
    expect(timer.pending).toBe(0);
  });

  it('runs a timer once', () => {
    const timer = manualTimer();
    let count = 0;
    timer.set(() => (count += 1), 10);

    timer.advance(1000);
    timer.advance(1000);
    expect(count).toBe(1);
  });

  it('runs timers in the order of their times, and of the order they were set when the times are the same', () => {
    const timer = manualTimer();
    const ran: string[] = [];
    timer.set(() => ran.push('late'), 30);
    timer.set(() => ran.push('first of two'), 10);
    timer.set(() => ran.push('second of two'), 10);
    timer.set(() => ran.push('middle'), 20);

    timer.advance(100);
    expect(ran).toEqual(['first of two', 'second of two', 'middle', 'late']);
  });

  it('does not run a timer that was cleared, and says so with the handle that it gave', () => {
    const timer = manualTimer();
    const ran: string[] = [];
    const handle = timer.set(() => ran.push('cleared'), 10);
    timer.set(() => ran.push('kept'), 10);

    timer.clear(handle);
    expect(timer.pending).toBe(1);
    timer.advance(10);
    expect(ran).toEqual(['kept']);
  });

  it('ignores a handle that it does not have, or has already run', () => {
    const timer = manualTimer();
    const handle = timer.set(() => undefined, 1);
    timer.advance(1);

    expect(() => timer.clear(handle)).not.toThrow();
    expect(() => timer.clear('nothing')).not.toThrow();
  });

  it('runs a timer that falls due in the same move, which one that ran set', () => {
    const timer = manualTimer();
    const ran: string[] = [];
    timer.set(() => {
      ran.push('first');
      timer.set(() => ran.push('second'), 5);
      timer.set(() => ran.push('too far'), 500);
    }, 10);

    timer.advance(20);
    expect(ran).toEqual(['first', 'second']);
    expect(timer.pending).toBe(1);
  });

  it('counts a delay from the time at which the timer was set, even in the middle of a move', () => {
    const timer = manualTimer();
    const ran: number[] = [];
    timer.advance(1000);
    timer.set(() => ran.push(1), 10);

    timer.advance(9);
    expect(ran).toEqual([]);
    timer.advance(1);
    expect(ran).toEqual([1]);
  });

  it('runs a timer of no delay when time moves, even by nothing, and not when it is set', () => {
    const timer = manualTimer();
    let ran = false;
    timer.set(() => (ran = true), 0);

    expect(ran).toBe(false);
    timer.advance(0);
    expect(ran).toBe(true);
  });
});

describe('manualFrames', () => {
  it('runs the frame that was asked for when a spec says, with the time that it says, and only once', () => {
    const frames = manualFrames();
    const times: number[] = [];
    frames.request((time) => times.push(time));

    expect(frames.pending).toBe(1);
    expect(frames.frame(16)).toBe(1);
    expect(frames.frame(32)).toBe(0);
    expect(times).toEqual([16]);
    expect(frames.pending).toBe(0);
  });

  it('runs a frame that was asked for during a frame in the next one, as a page does', () => {
    const frames = manualFrames();
    const ran: string[] = [];
    frames.request(() => {
      ran.push('first');
      frames.request(() => ran.push('second'));
    });

    frames.frame(1);
    expect(ran).toEqual(['first']);
    expect(frames.pending).toBe(1);
    frames.frame(2);
    expect(ran).toEqual(['first', 'second']);
  });

  it('runs every frame that was asked for, in the order that they were asked for', () => {
    const frames = manualFrames();
    const ran: number[] = [];
    frames.request(() => ran.push(1));
    frames.request(() => ran.push(2));

    expect(frames.frame(1)).toBe(2);
    expect(ran).toEqual([1, 2]);
  });

  it('does not run a frame that was taken back, and ignores a handle that it does not have', () => {
    const frames = manualFrames();
    let ran = false;
    const handle = frames.request(() => (ran = true));
    expect(frames.requested).toBe(1);

    frames.cancel(handle);
    frames.cancel(handle);
    frames.cancel(99);

    expect(frames.requested).toBe(0);
    expect(frames.pending).toBe(0);
    expect(frames.frame(1)).toBe(0);
    expect(ran).toBe(false);
  });

  it('counts the frames that it was asked for, so that a spec can say that a loop did not ask for more than it needed', () => {
    const frames = manualFrames();
    frames.request(() => undefined);
    frames.frame(1);
    frames.request(() => undefined);

    expect(frames.requested).toBe(2);
  });
});
