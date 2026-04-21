/**
 * Resolve a TikTok live-room URL from the watcher page or target URL.
 * @param {{ data?: object, deps: object }} ctx
 * @returns {Promise<{ url: string, source: string, handle: string }>}
 */
export async function resolveLiveRoomUrl(ctx) {
  const { data = {}, deps } = ctx;
  const { page, targetUrl = "" } = data;

  const direct = resolveFromUrl(targetUrl);
  if (direct) {
    return { url: direct.url, source: "target_url", handle: direct.handle };
  }

  if (page && typeof page.evaluate === "function") {
    try {
      const resolved = await page.evaluate(() => {
        const clean = (value) => String(value || "").trim();
        const links = Array.from(document.querySelectorAll('a[href^="/@"]'));
        for (const link of links) {
          const href = clean(link.getAttribute("href") || "");
          if (!href) {
            continue;
          }
          const normalized = new URL(href, window.location.origin).toString();
          if (normalized.includes("/@")) {
            return normalized.endsWith("/live")
              ? normalized
              : `${normalized.replace(/\/$/, "")}/live`;
          }
        }
        return "";
      });
      if (resolved) {
        const parsed = parseHandleFromUrl(resolved);
        return {
          url: resolved,
          source: "dom_link",
          handle: parsed.handle
        };
      }
    } catch {
      // Best effort.
    }
  }

  return { url: "", source: "missing", handle: "" };
}

function resolveFromUrl(rawUrl) {
  const value = String(rawUrl || "").trim();
  if (!value) {
    return null;
  }

  try {
    const parsed = new URL(value);
    const resolved = parseHandleFromUrl(parsed.toString());
    if (!resolved.handle) {
      return null;
    }

    return {
      url: `https://www.tiktok.com/@${encodeURIComponent(resolved.handle)}/live`,
      handle: resolved.handle
    };
  } catch {
    return null;
  }
}

function parseHandleFromUrl(rawUrl) {
  const value = String(rawUrl || "").trim();
  if (!value) {
    return { handle: "" };
  }

  try {
    const parsed = new URL(value);
    const pathname = String(parsed.pathname || "");
    const match = pathname.match(/\/@([^/]+)/);
    if (!match || !match[1]) {
      return { handle: "" };
    }

    const handle = decodeURIComponent(match[1]).trim().toLowerCase();
    return { handle };
  } catch {
    return { handle: "" };
  }
}
