import { Injectable, signal } from '@angular/core';

/**
 * The tour is asked for by the chooser (ADR-0082) before the canvas it is taken on is shown, and begun by the editor that opens that canvas (ADR-0083): the two do not know each other, so
 * this is what is between them. The editor takes the request, and a request is taken once.
 */
@Injectable({ providedIn: 'root' })
export class TourRequests {
  private readonly asked = signal(false);

  /** The next editor to open is to begin the tour. */
  request(): void {
    this.asked.set(true);
  }

  /** Whether the tour was asked for, and from now on it was not. */
  take(): boolean {
    const was = this.asked();
    this.asked.set(false);
    return was;
  }
}
