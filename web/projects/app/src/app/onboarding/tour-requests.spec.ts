import { describe, expect, it } from 'vitest';
import { TourRequests } from './tour-requests';

/** What is between the chooser and the editor that begins the tour (ADR-0083). */

describe('TourRequests', () => {
  it('has not been asked for the tour until it is', () => {
    expect(new TourRequests().take()).toBe(false);
  });

  it('says once that the tour was asked for, and then that it was not', () => {
    const requests = new TourRequests();

    requests.request();

    expect(requests.take()).toBe(true);
    expect(requests.take()).toBe(false);
  });

  it('is one request, however many times it was made', () => {
    const requests = new TourRequests();

    requests.request();
    requests.request();

    expect(requests.take()).toBe(true);
    expect(requests.take()).toBe(false);
  });

  it('can be asked again once it was taken', () => {
    const requests = new TourRequests();
    requests.request();
    requests.take();

    requests.request();

    expect(requests.take()).toBe(true);
  });
});
