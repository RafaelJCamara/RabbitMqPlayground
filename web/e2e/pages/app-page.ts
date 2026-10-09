import type { Locator, Page, Response } from '@playwright/test';
import { skipWelcome } from './editor-page';

/** The application's front page: the workspace of the canvases, whose first run asks what to start with (ADR-0084). Paths are relative to the base path (`/RabbitMqPlayground/`). */
export class AppPage {
  readonly heading: Locator;

  constructor(readonly page: Page) {
    this.heading = page.getByRole('heading', { level: 1 });
  }

  /** Opens `path` below the base path, answers the question of a first run the way a learner does who builds from scratch, and waits until the app has rendered. Do not start the path with a slash. */
  async goto(path = ''): Promise<Response | null> {
    const response = await this.page.goto(path);
    await skipWelcome(this.page);
    await this.heading.waitFor();
    return response;
  }
}
