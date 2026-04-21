/**
 * Probe minimal watch signals for one TikTok target page.
 * @param {{ data?: object, deps: object }} ctx
 * @returns {Promise<object>}
 */
export async function probeWatchSignals(ctx) {
  const { data = {}, deps } = ctx;
  const { page, targetUrl = "" } = data;

  if (!page) {
    throw new Error("Missing page for signal probe.");
  }

  const result = await page.evaluate((ctxData) => {
    const normalizeSearchTerm = (url) => {
      try {
        const parsed = new URL(url);
        return String(parsed.searchParams.get("q") || "").trim().replace(/\s+/g, " ");
      } catch {
        return "";
      }
    };

    const containsLiveBadge = ({ bodyText, root }) => {
      const exactTextMatch = Array.from(
        root.querySelectorAll("span, div, button, a")
      ).some((el) => String(el.innerText || el.textContent || "").trim() === "LIVE");

      return exactTextMatch || bodyText.includes(" live ");
    };

    const readyState = document.readyState;
    const loginLabels = Array.from(
      document.querySelectorAll("div.TUXButton-label")
    ).map((el) => String(el.innerText || el.textContent || "").trim());
    const hasLoginLabel = loginLabels.some((text) => text === "Log in");
    const hasPasswordField = !!document.querySelector("input[type='password']");

    const bodyText = String(document.body?.innerText || "").toLowerCase();
    const query = normalizeSearchTerm(ctxData.targetUrl);
    const hasTargetSearchText = query
      ? bodyText.includes(query.toLowerCase())
      : false;
    const hasLiveBadge = containsLiveBadge({
      bodyText,
      root: document
    });

    return {
      readyState,
      hasLoginLabel,
      hasPasswordField,
      hasTargetSearchText,
      hasLiveBadge
    };
  }, { targetUrl });

  return {
    pageReady: result.readyState === "complete",
    readyState: result.readyState,
    hasLoginLabel: result.hasLoginLabel,
    hasPasswordField: result.hasPasswordField,
    hasTargetSearchText: result.hasTargetSearchText,
    hasLiveBadge: result.hasLiveBadge
  };
}
