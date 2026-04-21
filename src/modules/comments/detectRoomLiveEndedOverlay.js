/**
 * Detect the TikTok live-ended overlay in a room window.
 * @param {{ data?: object, deps: object }} ctx
 * @returns {Promise<{ ended: boolean, reason: string, matchedText: string, matchedCount: number, selector: string }>}
 */
export async function detectRoomLiveEndedOverlay(ctx) {
  const { data = {} } = ctx;
  const { page } = data;
  const selector = "div.H2-Medium.text-center";
  const expectedText = "LIVE has ended";

  if (!page || typeof page.evaluate !== "function") {
    return {
      ended: false,
      reason: "page_unavailable",
      matchedText: "",
      matchedCount: 0,
      selector
    };
  }

  try {
    return await page.evaluate((payload) => {
      const clean = (value) =>
        String(value || "")
          .replace(/\s+/g, " ")
          .trim();
      const selectorText = String(payload?.selector || "div.H2-Medium.text-center");
      const expected = String(payload?.expectedText || "LIVE has ended");
      const nodes = Array.from(document.querySelectorAll(selectorText));
      const matchedNode = nodes.find((node) => clean(node?.textContent || "") === expected) || null;

      return {
        ended: !!matchedNode,
        reason: matchedNode ? "live_ended_overlay" : "not_ended",
        matchedText: matchedNode ? clean(matchedNode.textContent || "") : "",
        matchedCount: nodes.length,
        selector: selectorText
      };
    }, { selector, expectedText });
  } catch {
    return {
      ended: false,
      reason: "evaluation_failed",
      matchedText: "",
      matchedCount: 0,
      selector
    };
  }
}
