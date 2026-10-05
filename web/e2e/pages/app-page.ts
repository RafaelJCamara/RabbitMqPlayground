import type { Locator, Page, Response } from '@playwright/test';

/** The application's front page. Paths are relative to the base path (`/RabbitMqPlayground/`). */
export class AppPage {
  readonly heading: Locator;

  constructor(readonly page: Page) {
    this.heading = page.getByRole('heading', { level: 1 });
  }

  /** Opens `path` below the base path and waits until the app has rendered. Do not start the path with a slash. */
  async goto(path = ''): Promise<Response | null> {
    const response = await this.page.goto(path);
    await this.heading.waitFor();
    return response;
  }

  /** The feature flags that are on, according to the e2e build's debug handle. */
  flags(): Promise<string[]> {
    return this.page.evaluate(() => [...(window.__rmq?.flags() ?? [])].sort());
  }
}
