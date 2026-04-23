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

    const containsLiveBadge = ({ root }) => {
      const liveBadgeSelectors = [
        "span[class*='LiveBadge']",
        "span[class*='livebadge']",
        "[data-e2e*='live-badge']",
        "[data-e2e*='livebadge']",
        "a[href*='/live'] span"
      ];

      const exactTextMatch = Array.from(
        root.querySelectorAll("span, div, button, a")
      ).some((el) => String(el.innerText || el.textContent || "").trim() === "LIVE");

      if (exactTextMatch) {
        return true;
      }

      return liveBadgeSelectors.some((selector) =>
        Array.from(root.querySelectorAll(selector)).some((el) => {
          const text = String(el.innerText || el.textContent || "").trim();
          return text === "LIVE";
        })
      );
    };

    const readyState = document.readyState;
    const title = String(document.title || "").trim();
    const hasSearchTitle = title.toLowerCase().includes("tiktok search");
    const loginLabels = Array.from(
      document.querySelectorAll("div.TUXButton-label")
    ).map((el) => String(el.innerText || el.textContent || "").trim());
    const hasLoginLabel = loginLabels.some((text) => text === "Log in");
    const hasPasswordField = !!document.querySelector("input[type='password']");

    const bodyText = String(document.body?.innerText || "").toLowerCase();
    const hasPageError =
      bodyText.includes("something went wrong") ||
      bodyText.includes("sorry, something wrong with the server") ||
      bodyText.includes("please try again");
    const query = normalizeSearchTerm(ctxData.targetUrl);
    const hasTargetSearchText = hasSearchTitle || (query
      ? bodyText.includes(query.toLowerCase())
      : false);
    const hasLiveBadge = containsLiveBadge({ root: document });

    return {
      readyState,
      title,
      hasSearchTitle,
      hasLoginLabel,
      hasPasswordField,
      hasPageError,
      hasTargetSearchText,
      hasLiveBadge
    };
  }, { targetUrl });

  return {
    pageReady: result.readyState === "complete",
    readyState: result.readyState,
    title: result.title,
    hasSearchTitle: result.hasSearchTitle,
    hasLoginLabel: result.hasLoginLabel,
    hasPasswordField: result.hasPasswordField,
    hasPageError: result.hasPageError,
    hasTargetSearchText: result.hasTargetSearchText,
    hasLiveBadge: result.hasLiveBadge
  };
}
