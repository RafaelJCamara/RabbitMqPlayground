import { LiveAnnouncer } from '@angular/cdk/a11y';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { Announcer } from './announcer';

describe('Announcer', () => {
  it('speaks through the live region of the CDK when nothing has put another in front of it', () => {
    const live = TestBed.inject(LiveAnnouncer);
    const speak = vi.spyOn(live, 'announce').mockResolvedValue();
    const announcer = TestBed.inject(Announcer);

    announcer.announce('Added queue billing.');
    announcer.announce('Refused.', 'assertive');

    expect(speak).toHaveBeenNthCalledWith(1, 'Added queue billing.', 'polite');
    expect(speak).toHaveBeenNthCalledWith(2, 'Refused.', 'assertive');
    expect(announcer.last()).toBe('Refused.');
  });

  it('speaks through a sink instead, which is the canvas own live region, until it is taken away', () => {
    const live = TestBed.inject(LiveAnnouncer);
    const speak = vi.spyOn(live, 'announce').mockResolvedValue();
    const announcer = TestBed.inject(Announcer);
    const sink = vi.fn();

    const stop = announcer.useSink(sink);
    announcer.announce('One.');
    announcer.announce('Two.', 'assertive');
    expect(sink.mock.calls).toEqual([
      ['One.', 'polite'],
      ['Two.', 'assertive'],
    ]);
    expect(speak).not.toHaveBeenCalled();

    stop();
    announcer.announce('Three.');
    expect(speak).toHaveBeenCalledWith('Three.', 'polite');
  });

  it('does not take away a sink that another one has replaced', () => {
    const announcer = TestBed.inject(Announcer);
    const first = vi.fn();
    const second = vi.fn();

    const stopFirst = announcer.useSink(first);
    announcer.useSink(second);
    stopFirst();
    announcer.announce('Still the second.');

    expect(second).toHaveBeenCalledWith('Still the second.', 'polite');
    expect(first).not.toHaveBeenCalled();
  });
});
