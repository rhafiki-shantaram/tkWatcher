import { formatCommentConsoleLine } from "./commentConsoleFormat.js";
import { createCommentIngestPayload } from "./commentIngestPayload.js";
import { persistCommentCaptureComment } from "./commentCaptureStorage.js";
import { inspectLiveRoomNavigation } from "./resolveLiveRoomUrl.js";

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
    commentPersistenceState = null
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
  if (!commentPersistenceState || typeof commentPersistenceState !== "object") {
    throw new Error("Missing commentPersistenceState for room comment capture tick.");
  }

  const currentRoomUrl = typeof page.url === "function" ? page.url() : "";
  const navigationSignal = inspectLiveRoomNavigation(currentRoomUrl, roomHandle);
  if (navigationSignal.isNonTargetLive) {
    return {
      observed: 0,
      emitted: 0,
      enriched: 0,
      stopped: true,
      stopReason: "non_target_navigation"
    };
  }

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
      const profileLink = Array.from(node.querySelectorAll("a[href]")).find((anchor) => {
        const href = clean(anchor?.getAttribute("href") || "");
        return href.includes("/@");
      }) || null;
      const profileHrefRaw = clean(profileLink?.getAttribute("href") || "");
      const profileHref = profileHrefRaw
        ? new URL(profileHrefRaw, window.location.origin).toString()
        : "";
      const profileName = profileHref.includes("/@")
        ? decodeURIComponent(String(profileHref.split("/@")[1]?.split("/")[0] || "")).trim()
        : "";
      const key = [
        sanitizeKey(ownerName.toLowerCase()),
        sanitizeKey(commentText.toLowerCase())
      ].join("|");
      node.dataset.orderbotCommentKey = key;

      return {
        key: key || `comment_${idx}`,
        commenter: ownerName,
        text: commentText,
        profileName,
        profileHref,
        profileSource: profileHref ? "dom" : ""
      };
    });
  });

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

    const profileName = String(item.profileName || "").trim();
    const profileHref = String(item.profileHref || "").trim();
    const profileSource = String(item.profileSource || "").trim();
    if (profileHref) {
      enriched += 1;
    }

    const commentPayload = createCommentIngestPayload({
      data: {
        roomHandle,
        roomUrl,
        commentKey: item.key,
        commenter: item.commenter,
        text: item.text,
        profileName,
        profileHref,
        profileSource,
        source: "dom",
        emittedAt: Date.now()
      }
    });

    if (!String(commentPayload.shopRoomCode || "").trim()) {
      logger.info(
        `commentRoom:comment_skipped handle=${commentPayload.roomHandle || "(unknown)"} reason=unmapped_shop_room_code commentKey=${commentPayload.commentKey || "(unknown)"} commenter=${commentPayload.commenter || "(unknown)"}`
      );
      continue;
    }

    logger.info(
      formatCommentConsoleLine({
        shopRoomCode: commentPayload.shopRoomCode,
        commentKey: commentPayload.commentKey,
        commentKeyWithTimestamp: commentPayload.commentKeyWithTimestamp
      })
    );

    try {
      await persistCommentCaptureComment({
        data: {
          storageState: commentPersistenceState,
          comment: commentPayload
        },
        deps
      });
    } catch (error) {
      logger.info(
        `commentRoom:comment_write_error handle=${roomHandle || "(unknown)"} shopRoomCode=${commentPayload.shopRoomCode || "(unknown)"} error=${error && typeof error === "object" ? (error.message || String(error)) : String(error)}`
      );
    }

    emitted += 1;
  }

  return {
    observed: snapshot.length,
    emitted,
    enriched
  };
}

/**
 * Create state for room comment capture.
 * @returns {{ seenCommentKeys: Set<string> }}
 */
export function createRoomCommentCaptureState() {
  return {
    seenCommentKeys: new Set()
  };
}
