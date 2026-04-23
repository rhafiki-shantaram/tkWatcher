import { parseLiveRoomUrl } from "./resolveLiveRoomUrl.js";

/**
 * Resolve live room candidates from the watcher page.
 * Discovery only; room-window stop logic belongs elsewhere.
 * @param {{ data?: object, deps: object }} ctx
 * @returns {Promise<Array<{ handle: string, url: string, source: string }>>}
 */
export async function resolveLiveRoomCandidates(ctx) {
  const { data = {}, deps } = ctx;
  const { page } = data;

  if (!page || typeof page.evaluate !== "function") {
    return [];
  }

  try {
    const candidates = await page.evaluate(() => {
      const clean = (value) => String(value || "").trim();
      const urls = new Set();

      const liveLinks = Array.from(document.querySelectorAll('a[href*="/live"]'));
      for (const link of liveLinks) {
        const href = clean(link.getAttribute("href") || "");
        if (!href) {
          continue;
        }

        try {
          const normalized = new URL(href, window.location.origin).toString();
          urls.add(normalized);
        } catch {
          // Best effort.
        }
      }

      return Array.from(urls.values());
    });

    if (!Array.isArray(candidates)) {
      return [];
    }

    const handles = new Map();
    for (const candidateUrl of candidates) {
      const parsed = parseLiveRoomUrl(candidateUrl);
      if (parsed.status !== "matched" || !parsed.handle) {
        continue;
      }

      handles.set(parsed.handle, {
        handle: parsed.handle,
        url: parsed.url,
        source: "dom_live_link"
      });
    }

    return Array.from(handles.values());
  } catch {
    return [];
  }
}
