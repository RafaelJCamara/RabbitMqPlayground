import { TestBed } from '@angular/core/testing';
import { manualFrames, type ManualFrames } from '@rmq/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { FRAME_SOURCE, FrameLoop, MAX_FRAME_MS } from './frame-loop';

describe('FrameLoop', () => {
  let frames: ManualFrames;
  let loop: FrameLoop;

  beforeEach(() => {
    frames = manualFrames();
    TestBed.configureTestingModule({ providers: [FrameLoop, { provide: FRAME_SOURCE, useValue: frames }] });
    loop = TestBed.inject(FrameLoop);
  });

  it('asks for no frame until something wakes it, so that a canvas at rest costs none', () => {
    loop.add(() => true);

    expect(frames.requested).toBe(0);
    expect(loop.awake).toBe(false);
  });

  it('asks for one frame however many times it is woken before it comes', () => {
    loop.add(() => false);
    loop.wake();
    loop.wake();
    loop.wake();

    expect(frames.requested).toBe(1);
    expect(loop.awake).toBe(true);
  });

  it('runs what was added, in the frame, with how long the frame lasted and the time of it, and asks for another while something wants one', () => {
    const seen: number[][] = [];
    loop.add((elapsed, time) => {
      seen.push([elapsed, time]);
      return true;
    });
    loop.wake();

    frames.frame(1_000);
    frames.frame(1_016);
    frames.frame(1_033);

    // The first frame has nothing before it to measure from.
    expect(seen).toEqual([
      [0, 1_000],
      [16, 1_016],
      [17, 1_033],
    ]);
    expect(frames.pending).toBe(1);
  });

  it('stops asking for frames when nothing wants another, and starts again, from a first frame that lasts no time, when it is woken', () => {
    const elapsed: number[] = [];
    let wanted = true;
    loop.add((lasted) => {
      elapsed.push(lasted);
      return wanted;
    });
    loop.wake();
    frames.frame(100);
    frames.frame(116);
    wanted = false;
    frames.frame(132);

    expect(frames.pending).toBe(0);
    expect(loop.awake).toBe(false);

    wanted = true;
    loop.wake();
    frames.frame(5_000);

    expect(elapsed).toEqual([0, 16, 16, 0]);
  });

  it('asks for another frame when any one of what it runs wants one, and runs all of them in each', () => {
    const ran: string[] = [];
    loop.add(() => {
      ran.push('idle');
      return false;
    });
    loop.add(() => {
      ran.push('busy');
      return true;
    });
    loop.wake();

    frames.frame(1);

    expect(ran).toEqual(['idle', 'busy']);
    expect(frames.pending).toBe(1);
  });

  it('does not run what was taken away, and lets a ticker take itself away while it runs', () => {
    const ran: string[] = [];
    const remove = loop.add(() => {
      ran.push('removed');
      return true;
    });
    const stop = loop.add(() => {
      ran.push('once');
      stop();
      return true;
    });
    remove();
    loop.wake();

    frames.frame(1);
    frames.frame(2);

    expect(ran).toEqual(['once']);
  });

  it('counts a frame that lasted longer than a frame can, as the longest, so that a page that was in the background does not make the simulation jump', () => {
    const elapsed: number[] = [];
    loop.add((lasted) => {
      elapsed.push(lasted);
      return true;
    });
    loop.wake();

    frames.frame(0);
    frames.frame(60_000);
    frames.frame(60_010);

    expect(elapsed).toEqual([0, MAX_FRAME_MS, 10]);
  });

  it('counts a time that went backwards as no time', () => {
    const elapsed: number[] = [];
    loop.add((lasted) => {
      elapsed.push(lasted);
      return true;
    });
    loop.wake();

    frames.frame(100);
    frames.frame(90);

    expect(elapsed).toEqual([0, 0]);
  });

  it('takes back the frame that it asked for when it is destroyed', () => {
    loop.add(() => true);
    loop.wake();

    TestBed.resetTestingModule();

    expect(frames.pending).toBe(0);
  });
});

describe('the page’s frames', () => {
  it('are the window’s, which the loop uses when a page gives it no others: one comes, with the time of the page, and one that is taken back does not', async () => {
    TestBed.configureTestingModule({ providers: [FrameLoop] });
    const source = TestBed.inject(FRAME_SOURCE);

    const time = await new Promise<number>((resolve) => {
      source.cancel(source.request(() => resolve(-1)));
      source.request(resolve);
    });

    expect(time).toBeGreaterThan(0);
  });
});
