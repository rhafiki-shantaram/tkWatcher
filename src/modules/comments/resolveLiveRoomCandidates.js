/**
 * Resolve live room candidates from the watcher page.
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
      const handles = new Map();

      const liveLinks = Array.from(document.querySelectorAll('a[href*="/live"]'));
      for (const link of liveLinks) {
        const href = clean(link.getAttribute("href") || "");
        if (!href) {
          continue;
        }

        try {
          const normalized = new URL(href, window.location.origin).toString();
          const match = normalized.match(/\/@([^/]+)\/live/i);
          const handle = clean(
            decodeURIComponent(match?.[1] || normalized.split("/@")[1]?.split("/")[0] || "")
          ).toLowerCase();
          if (!handle) {
            continue;
          }

          handles.set(handle, {
            handle,
            url: `https://www.tiktok.com/@${encodeURIComponent(handle)}/live`,
            source: "dom_live_link"
          });
        } catch {
          // Best effort.
        }
      }

      return Array.from(handles.values());
    });

    return Array.isArray(candidates) ? candidates : [];
  } catch {
    return [];
  }
}
