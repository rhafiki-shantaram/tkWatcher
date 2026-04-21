import { createCommentCaptureStageError } from "./commentCaptureStageError.js";
import { resolveCommentProfileBackground } from "./resolveCommentProfileBackground.js";

/**
 * Resolve profile data with short retries and named failures.
 * @param {{ data?: object, deps: object }} ctx
 * @returns {Promise<{ profileName: string, profileHref: string, source: string, attempts: string[] }>}
 */
export async function captureCommentProfileWithSemantics(ctx) {
  const { data = {}, deps } = ctx;
  const {
    page,
    resolveProfileFromNetwork = null,
    revealPopover = null,
    maxAttempts = 2,
    waitMs = 4000
  } = data;

  if (!page) {
    throw createCommentCaptureStageError(
      "comment_profile_missing_page",
      "Missing page for comment profile capture.",
      "E_COMMENT_PROFILE_MISSING_PAGE"
    );
  }

  const attemptLimit = Math.max(1, Math.floor(Number(maxAttempts) || 1));
  let lastResult = null;

  for (let attempt = 1; attempt <= attemptLimit; attempt += 1) {
    const result = await resolveCommentProfileBackground({
      data: {
        page,
        resolveProfileFromNetwork,
        revealPopover,
        waitMs
      },
      deps
    });
    lastResult = result;

    if (result.found) {
      deps.logger.info(
        [
          "commentProfile:resolved",
          `source=${result.source}`,
          `attempt=${attempt}`,
          `profileName=${result.profileName ? 1 : 0}`,
          `profileHref=${result.profileHref ? 1 : 0}`
        ].join(" ")
      );
      return result;
    }

    deps.logger.info(
      [
        "commentProfile:retry",
        `attempt=${attempt}`,
        `source=${result.source}`,
        `attempts=${result.attempts.join(",")}`
      ].join(" ")
    );
  }

  if (page.isClosed?.()) {
    throw createCommentCaptureStageError(
      "comment_capture_tab_closed",
      "Comment capture tab closed mid-capture.",
      "E_COMMENT_CAPTURE_TAB_CLOSED"
    );
  }

  throw createCommentCaptureStageError(
    "comment_profile_unresolved",
    buildCommentProfileFailureMessage(lastResult),
    "E_COMMENT_PROFILE_UNRESOLVED"
  );
}

function buildCommentProfileFailureMessage(result) {
  const source = String(result && result.source ? result.source : "missing").trim();
  const attempts = Array.isArray(result && result.attempts) && result.attempts.length > 0
    ? result.attempts.join(",")
    : "none";
  return `Unable to resolve comment profile. source=${source} attempts=${attempts}`;
}
