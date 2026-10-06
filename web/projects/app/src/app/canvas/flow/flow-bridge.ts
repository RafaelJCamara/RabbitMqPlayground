import { Directive, inject, type OnDestroy, type OnInit } from '@angular/core';
import { FA11yAnnouncer } from '@foblex/flow';
import { Announcer } from '../../core/announcer';

/**
 * Put on `<f-flow>`. The library speaks through a live region of its own, `FA11yAnnouncer`, which is provided at that element, and
 * which only something on that element can reach (ADR-0017). While the canvas is on the page, the app speaks through that
 * region too, so that what the library says and what the app says are in one place, in order.
 */
@Directive({ selector: 'f-flow[rmqFlowBridge]' })
export class FlowBridge implements OnInit, OnDestroy {
  private readonly library = inject(FA11yAnnouncer);
  private readonly announcer = inject(Announcer);
  private stop: (() => void) | undefined;

  ngOnInit(): void {
    this.stop = this.announcer.useSink((message, politeness) => this.library.announce(message, politeness));
  }

  ngOnDestroy(): void {
    this.stop?.();
  }
}
