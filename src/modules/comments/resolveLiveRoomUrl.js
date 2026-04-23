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
        const parsed = parseLiveRoomUrl(resolved);
        return {
          url: parsed.url,
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
  const parsed = parseLiveRoomUrl(rawUrl);
  if (parsed.status !== "matched") {
    return null;
  }

  return {
    url: parsed.url,
    handle: parsed.handle
  };
}

export function parseLiveRoomUrl(rawUrl) {
  const value = String(rawUrl || "").trim();
  if (!value) {
    return {
      status: "missing",
      handle: "",
      url: ""
    };
  }

  try {
    const parsed = new URL(value, "https://www.tiktok.com");
    const hostname = String(parsed.hostname || "").toLowerCase();
    if (hostname !== "tiktok.com" && !hostname.endsWith(".tiktok.com")) {
      return {
        status: "invalid",
        handle: "",
        url: ""
      };
    }
    const pathname = String(parsed.pathname || "");
    const match = pathname.match(/\/@([^/]+)(?:\/live(?:\/)?)?(?:\/)?$/i) || pathname.match(/\/@([^/]+)/i);
    if (!match || !match[1]) {
      return {
        status: "missing",
        handle: "",
        url: ""
      };
    }

    const handle = decodeURIComponent(match[1]).trim().toLowerCase();
    if (!handle) {
      return {
        status: "missing",
        handle: "",
        url: ""
      };
    }

    return {
      status: "matched",
      handle,
      url: `https://www.tiktok.com/@${encodeURIComponent(handle)}/live`
    };
  } catch {
    return {
      status: "invalid",
      handle: "",
      url: ""
    };
  }
}

export function inspectLiveRoomNavigation(rawUrl, targetHandle = "") {
  const parsed = parseLiveRoomUrl(rawUrl);
  const expectedHandle = String(targetHandle || "").trim().toLowerCase();

  if (parsed.status !== "matched" || !parsed.handle) {
    return {
      rawUrl: String(rawUrl || ""),
      matchedUrl: "",
      matchedHandle: "",
      expectedHandle,
      isTargetHandle: false,
      isNonTargetLive: false,
      reason: parsed.status === "invalid" ? "invalid" : "ambiguous"
    };
  }

  return {
    rawUrl: String(rawUrl || ""),
    matchedUrl: parsed.url,
    matchedHandle: parsed.handle,
    expectedHandle,
    isTargetHandle: Boolean(expectedHandle) && parsed.handle === expectedHandle,
    isNonTargetLive: Boolean(expectedHandle) && parsed.handle !== expectedHandle,
    reason: Boolean(expectedHandle) && parsed.handle !== expectedHandle ? "non_target_live" : "target_live"
  };
}
