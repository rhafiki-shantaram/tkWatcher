export async function isCommenterVisibleOnPage(ctx) {
  const { data = {} } = ctx || {};
  const {
    page,
    commenterName = ""
  } = data;

  if (!page || typeof page.evaluate !== "function") {
    return false;
  }

  return await page.evaluate((payload) => {
    const clean = (value) =>
      String(value || "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
    const targetName = clean(payload?.commenterName || "");
    if (!targetName) {
      return false;
    }

    const nodes = Array.from(document.querySelectorAll('div[data-e2e="chat-message"]'));
    return nodes.some((node) => {
      const ownerEl = node.querySelector('[data-e2e="message-owner-name"]');
      const ownerName = clean(ownerEl?.getAttribute("title") || ownerEl?.textContent || "");
      return ownerName === targetName;
    });
  }, { commenterName });
}

export async function resolveProfileFromRoomNetworkSnapshot(ctx) {
  const { data = {} } = ctx || {};
  const {
    roomState,
    commenterName = ""
  } = data;

  const networkStream = roomState && roomState.networkStream ? roomState.networkStream : null;
  if (!networkStream || typeof networkStream.snapshot !== "function") {
    return {
      profileName: "",
      profileHref: ""
    };
  }

  const snapshot = networkStream.snapshot();
  const events = Array.isArray(snapshot && snapshot.events) ? snapshot.events : [];
  for (let idx = events.length - 1; idx >= 0; idx -= 1) {
    const event = events[idx] || {};
    const candidateHref = extractProfileHrefFromValue(event.url || "");
    if (!candidateHref) {
      continue;
    }

    return {
      profileName: extractProfileNameFromHref(candidateHref) || String(commenterName || "").trim(),
      profileHref: candidateHref
    };
  }

  return {
    profileName: "",
    profileHref: ""
  };
}

export function upsertProfileCacheEntry(ctx) {
  const { data = {} } = ctx || {};
  const {
    state = null,
    commentUserName = "",
    profileName = "",
    profileHref = "",
    profileSource = "backfill"
  } = data;

  if (!state || !state.byUserName || typeof state.byUserName.set !== "function") {
    return null;
  }

  const normalizedKey = String(commentUserName || "").trim().toLowerCase();
  if (!normalizedKey) {
    return null;
  }

  const entry = state.byUserName.get(normalizedKey) || {
    userNameKey: normalizedKey,
    commentUserName: String(commentUserName || "").trim()
  };

  entry.userNameKey = normalizedKey;
  entry.commentUserName = String(commentUserName || entry.commentUserName || "").trim();
  entry.profileName = String(profileName || entry.profileName || "").trim();
  entry.profileHref = String(profileHref || entry.profileHref || "").trim();
  entry.profileSource = String(profileSource || entry.profileSource || "backfill").trim() || "backfill";

  state.byUserName.set(normalizedKey, entry);
  return entry;
}

export async function revealCommenterProfilePopover(ctx) {
  const { data = {} } = ctx || {};
  const {
    page,
    commenterName = ""
  } = data;

  if (!page || typeof page.evaluate !== "function") {
    return false;
  }

  return await page.evaluate((payload) => {
    const clean = (value) =>
      String(value || "")
        .replace(/\s+/g, " ")
        .trim();
    const targetName = clean(payload?.commenterName || "").toLowerCase();
    if (!targetName) {
      return false;
    }

    const messages = Array.from(document.querySelectorAll('div[data-e2e="chat-message"]'));
    const targetRoot = messages.find((node) => {
      const ownerEl = node.querySelector('[data-e2e="message-owner-name"]');
      const ownerName = clean(ownerEl?.getAttribute("title") || ownerEl?.textContent || "").toLowerCase();
      return ownerName === targetName;
    }) || null;

    if (!targetRoot) {
      return false;
    }

    const clickNode = (node) => {
      if (!node) {
        return false;
      }
      node.scrollIntoView?.({ behavior: "instant", block: "center" });
      try {
        node.click?.();
      } catch {
        // Fall through to synthetic click.
      }
      node.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          composed: true,
          view: window
        })
      );
      return true;
    };

    const ownerNameEl = targetRoot.querySelector('[data-e2e="message-owner-name"]');
    const avatarImg = targetRoot.querySelector("img");
    const avatarContainer = avatarImg?.parentElement || null;

    return clickNode(ownerNameEl) || clickNode(avatarContainer) || clickNode(avatarImg);
  }, { commenterName });
}

export async function closeCommentPopover(ctx) {
  const { data = {} } = ctx || {};
  const { page } = data;

  if (!page) {
    return;
  }

  try {
    const clicked = await page.evaluate(() => {
      const closeIcon = Array.from(document.querySelectorAll('svg.text-color-TextReverse2')).find(
        (node) => String(node.getAttribute("viewBox") || "") === "0 0 48 48"
      ) || null;
      const closeButton = closeIcon?.parentElement || closeIcon?.closest("div.cursor-pointer") || null;
      if (!closeButton) {
        return false;
      }
      try {
        closeButton.click?.();
      } catch {
        // Fall through to synthetic click.
      }
      closeButton.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          composed: true,
          view: window
        })
      );
      return true;
    });
    if (clicked) {
      return;
    }
  } catch {
    // Best effort.
  }

  try {
    await page.keyboard.press("Escape");
  } catch {
    // Best effort.
  }

  try {
    await page.waitForFunction(
      () => !Array.from(document.querySelectorAll("div.absolute.h-auto")).some((popover) => {
        const name = popover.querySelector("div.P2-Bold");
        const profileLink = popover.querySelector('a[href^="/@"]');
        return !!(name || profileLink);
      }),
      { timeout: 300 }
    );
  } catch {
    // Best effort.
  }
}

function extractProfileHrefFromValue(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }

  try {
    const url = new URL(text, "https://www.tiktok.com");
    const normalized = url.toString();
    if (normalized.includes("/@")) {
      return normalized;
    }
  } catch {
    if (text.includes("/@")) {
      return text.startsWith("http") ? text : `https://www.tiktok.com${text.startsWith("/") ? "" : "/"}${text}`;
    }
  }

  return "";
}

function extractProfileNameFromHref(href) {
  const text = String(href || "").trim();
  if (!text || !text.includes("/@")) {
    return "";
  }

  try {
    const url = new URL(text);
    const handle = String(url.pathname || "")
      .split("/@")[1]
      ?.split("/")[0] || "";
    return decodeURIComponent(handle).trim();
  } catch {
    return decodeURIComponent(String(text.split("/@")[1]?.split("/")[0] || "")).trim();
  }
}
