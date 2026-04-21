import { formatCommentConsoleLine } from "./commentConsoleFormat.js";

/**
 * Capture newly observed room comments and emit them to the terminal.
 * @param {{ data?: object, deps: object }} ctx
 * @returns {Promise<{ observed: number, emitted: number }>}
 */
export async function captureRoomCommentsTick(ctx) {
  const { data = {}, deps } = ctx;
  const {
    page,
    roomHandle = "",
    roomUrl = "",
    captureState
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

      return {
        key: key || `comment_${idx}`,
        commenter: ownerName,
        text: commentText
      };
    });
  });

  let emitted = 0;
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
    logger.info(
      formatCommentConsoleLine({
        roomHandle,
        roomUrl,
        commenter: item.commenter,
        text: item.text,
        source: "dom"
      })
    );
    emitted += 1;
  }

  return {
    observed: snapshot.length,
    emitted
  };
}

/**
 * Create state for room comment dedupe.
 * @returns {{ seenCommentKeys: Set<string> }}
 */
export function createRoomCommentCaptureState() {
  return {
    seenCommentKeys: new Set()
  };
}
