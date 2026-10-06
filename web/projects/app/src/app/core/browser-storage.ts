/** The browser's storage, or `null` when it will not give it (touching `localStorage` can throw, in a private window or with site data blocked). */
export function localStorageOf(page: Document): Storage | null {
  try {
    return page.defaultView?.localStorage ?? null;
  } catch {
    return null;
  }
}
