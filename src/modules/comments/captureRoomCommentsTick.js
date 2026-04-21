import { formatCommentConsoleLine } from "./commentConsoleFormat.js";
import {
  normalizeCommenterBackfillKey,
  queueCommenterBackfillCandidate,
  registerCommenterBackfillRecord
} from "./commenterBackfillState.js";
import { resolveCommentProfileBackground } from "./resolveCommentProfileBackground.js";

/**
 * Capture newly observed room comments and emit them to the terminal.
 * @param {{ data?: object, deps: object }} ctx
 * @returns {Promise<{ observed: number, emitted: number, enriched: number }>}
 */
export async function captureRoomCommentsTick(ctx) {
  const { data = {}, deps } = ctx;
  const {
    page,
    roomHandle = "",
    roomUrl = "",
    captureState,
    profileCacheState = null,
    commenterBackfillState = null,
    maxProfileResolvesPerTick = 1
  } = data;
  const { logger } = deps;

  if (!page) {
    throw new Error("Missing page for room comment capture tick.");
  }
  if (!captureState || typeof captureState !== "object") {
    throw new Error("Missing captureState for room comment capture tick.");
  }
  if (!captureState.seenCommentKeys || typeof captureState.seenCommentKeys.add !== "function") {
    throw new Error("Missing captureState.seenCommentKeys set.");
  }

  const profileCacheByUserName = profileCacheState && profileCacheState.byUserName
    ? profileCacheState.byUserName
    : null;
  const profileResolveBudget = Math.max(0, Math.floor(Number(maxProfileResolvesPerTick) || 0));
  const snapshot = await page.evaluate(() => {
    const clean = (value) =>
      String(value || "")
        .replace(/\s+/g, " ")
        .trim();
    const sanitizeKey = (value) =>
      String(value || "")
        .replace(/\|/g, " ")
        .trim();

    const messages = Array.from(
      document.querySelectorAll('div[data-e2e="chat-message"]')
    );

    return messages.map((node, idx) => {
      const ownerEl = node.querySelector('[data-e2e="message-owner-name"]');
      const ownerName = clean(ownerEl?.getAttribute("title") || ownerEl?.textContent || "");
      const commentEl = node.querySelector("div.w-full.break-words.align-middle");
      const commentText = clean(commentEl?.textContent || "");
      const key = [
        sanitizeKey(ownerName.toLowerCase()),
        sanitizeKey(commentText.toLowerCase())
      ].join("|");
      node.dataset.orderbotCommentKey = key;

      return {
        key: key || `comment_${idx}`,
        commenter: ownerName,
        text: commentText
      };
    });
  });

  const profileResolutionKeys = new Set();
  let emitted = 0;
  let enriched = 0;
  for (const item of snapshot) {
    if (!item || !item.key) {
      continue;
    }
    if (!item.commenter || !item.text) {
      continue;
    }
    if (captureState.seenCommentKeys.has(item.key)) {
      continue;
    }
    captureState.seenCommentKeys.add(item.key);
    let usedInteractiveCapture = false;
    let profileName = item.commenter;
    let profileHref = "";
    let profileSource = "fallback";

    try {
      const commenterKey = normalizeCommenterBackfillKey(item.commenter);

      if (commenterKey && profileCacheByUserName && profileCacheByUserName.has(commenterKey)) {
        const cachedProfile = profileCacheByUserName.get(commenterKey) || {};
        profileName = String(cachedProfile.profileName || "").trim() || item.commenter;
        profileHref = String(cachedProfile.profileHref || "").trim();
        profileSource = String(cachedProfile.profileSource || "cache").trim() || "cache";
      } else if (commenterKey && profileResolutionKeys.size < profileResolveBudget) {
        profileResolutionKeys.add(commenterKey);
        usedInteractiveCapture = true;
        await closeCommentPopover(page);
        const resolvedProfile = await resolveCommentProfileBackground({
          data: {
            page,
            waitMs: 4000,
            revealPopover: async () => {
              await clickCommentUser({
                data: {
                  page,
                  key: item.key
                },
                deps
              });
            }
          },
          deps
        });

        profileName = String(resolvedProfile.profileName || "").trim() || item.commenter;
        profileHref = String(resolvedProfile.profileHref || "").trim();
        profileSource = String(resolvedProfile.source || "").trim() || "fallback";

        if (profileCacheByUserName) {
          profileCacheByUserName.set(commenterKey, {
            userNameKey: commenterKey,
            commentUserName: item.commenter,
            profileName,
            profileHref,
            profileSource
          });
        }
        if (profileName || profileHref) {
          enriched += 1;
        }
      } else if (commenterKey && profileCacheByUserName && !profileCacheByUserName.has(commenterKey)) {
        profileCacheByUserName.set(commenterKey, {
          userNameKey: commenterKey,
          commentUserName: item.commenter,
          profileName,
          profileHref: "",
          profileSource
        });
      }
    } catch (error) {
      logger.info(
        `commentRoom:comment_enrich_error handle=${roomHandle || "(unknown)"} error=${error.message || error}`
      );
    } finally {
      if (usedInteractiveCapture) {
        await closeCommentPopover(page);
        try {
          await page.bringToFront();
        } catch {
          // Best effort.
        }
      }
    }

    logger.info(
      formatCommentConsoleLine({
        roomHandle,
        roomUrl,
        commenter: item.commenter,
        text: item.text,
        source: "dom",
        profileName,
        profileHref,
        profileSource
      })
    );
    const queuedResult = queueCommenterBackfillCandidate({
      data: {
        state: commenterBackfillState,
        commentUserName: item.commenter,
        profileName,
        profileHref,
        profileSource,
        seenAt: Date.now()
      },
      deps
    });
    if (queuedResult && queuedResult.queued) {
      logger.info(
        [
          "commentBackfill:queued",
          `handle=${roomHandle || "(unknown)"}`,
          `commenter=${item.commenter}`,
          `normalizedKey=${queuedResult.normalizedKey || "(unknown)"}`,
          `status=${String(queuedResult.entry?.status || "pending")}`,
          `queueSize=${Array.isArray(commenterBackfillState?.queue) ? commenterBackfillState.queue.length : 0}`
        ].join(" ")
      );
    }
    registerCommenterBackfillRecord({
      data: {
        state: captureState,
        commentKey: item.key,
        commentUserName: item.commenter,
        text: item.text,
        profileName,
        profileHref,
        profileSource,
        emittedAt: Date.now()
      },
      deps
    });
    emitted += 1;
  }

  return {
    observed: snapshot.length,
    emitted,
    enriched
  };
}

/**
 * Create state for room comment dedupe.
 * @returns {{ seenCommentKeys: Set<string> }}
 */
export function createRoomCommentCaptureState() {
  return {
    seenCommentKeys: new Set(),
    byCommentKey: new Map(),
    commentKeysByUserName: new Map()
  };
}

async function clickCommentUser(ctx) {
  const { data = {}, deps } = ctx;
  const { page, key } = data;

  const clicked = await page.evaluate((commentKey) => {
    const root = Array.from(document.querySelectorAll('div[data-e2e="chat-message"]')).find(
      (node) => String(node.dataset.orderbotCommentKey || "") === String(commentKey || "")
    ) || null;
    if (!root) {
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

    const ownerNameEl = root.querySelector('[data-e2e="message-owner-name"]');
    const avatarImg = root.querySelector("img");
    const avatarContainer = avatarImg?.parentElement || null;

    if (clickNode(ownerNameEl) || clickNode(avatarContainer) || clickNode(avatarImg)) {
      return true;
    }

    return false;
  }, key);

  if (!clicked) {
    throw new Error(`Failed to click comment user for key=${key}`);
  }
}

async function closeCommentPopover(page) {
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
