import { probeWatchSignals } from "./probeWatchSignals.js";

/**
 * Detect one target status on TikTok search page.
 * @param {{ data?: object, deps: object }} ctx
 * @returns {Promise<{ status: string, found: boolean, live: boolean, signals: object }>}
 */
export async function detectTargetStatus(ctx) {
  const { data = {}, deps } = ctx;
  const { page, targetUrl = "" } = data;

  if (!page) {
    throw new Error("Missing page for target status detection.");
  }

  try {
    const signals = await probeWatchSignals({
      data: { page, targetUrl },
      deps
    });

    if (!signals.pageReady) {
      return buildResult("UNKNOWN", false, false, signals);
    }

    if (signals.hasLoginLabel || signals.hasPasswordField) {
      return buildResult("UNKNOWN", false, false, signals);
    }

    if (!signals.hasTargetSearchText) {
      return buildResult("NOT_FOUND", false, false, signals);
    }

    if (signals.hasLiveBadge) {
      return buildResult("LIVE", true, true, signals);
    }

    return buildResult("NOT_LIVE", true, false, signals);
  } catch {
    return buildResult("UNKNOWN", false, false, {
      pageReady: false,
      hasLoginLabel: false,
      hasPasswordField: false,
      hasTargetSearchText: false,
      hasLiveBadge: false
    });
  }
}

function buildResult(status, found, live, signals) {
  return {
    status,
    found,
    live,
    signals: {
      ready: !!signals.pageReady,
      hasSearchResults: !!signals.hasTargetSearchText,
      matchText: !!signals.hasTargetSearchText,
      liveBadge: !!signals.hasLiveBadge,
      liveLink: !!signals.hasLiveBadge,
      loginLabel: !!signals.hasLoginLabel,
      passwordField: !!signals.hasPasswordField
    }
  };
}
