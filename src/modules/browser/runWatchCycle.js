import { detectTargetStatus } from "./detectTargetStatus.js";
import { loadCookies } from "./loadCookies.js";
import { probeWatchSignals } from "./probeWatchSignals.js";
import { saveCookies } from "./saveCookies.js";
import { createStageError } from "./stageError.js";
import { selfHealTargetPage } from "./selfHealTargetPage.js";
import { waitForLoginComplete } from "./waitForLoginComplete.js";

/**
 * Run one lean watcher cycle for the target page.
 * @param {{ data?: object, deps: object }} ctx
 * @returns {Promise<object>}
 */
export async function runWatchCycle(ctx) {
  const { data = {}, deps } = ctx;
  const {
    page,
    targetUrl = "",
    cookiesPath = "cookies.json",
    navigationTimeoutMs = 120000,
    loginWaitMs = 120000,
    loginPollMs = 1500
  } = data;
  const { logger } = deps;

  if (!page) {
    throw new Error("Missing page for watch cycle.");
  }

  try {
    await page.goto("about:blank", {
      waitUntil: "load",
      timeout: navigationTimeoutMs
    });
  } catch {
    throw createStageError(
      "page_load_timeout",
      "Neutral page load timed out.",
      "E_PAGE_LOAD_TIMEOUT"
    );
  }

  const cookiesResult = await loadCookies({
    data: { cookiesPath, page },
    deps
  });

  try {
    await page.goto(targetUrl, {
      waitUntil: "load",
      timeout: navigationTimeoutMs
    });
  } catch {
    throw createStageError(
      "page_load_timeout",
      "Target navigation timed out.",
      "E_PAGE_LOAD_TIMEOUT"
    );
  }

  const initialHeal = await selfHealTargetPage({
    data: {
      page,
      targetUrl,
      navigationTimeoutMs
    },
    deps
  });

  logger.info(
    [
      "watchCycle",
      `heal=${initialHeal.status}`,
      `cookies=${cookiesResult.loaded ? 1 : 0}`
    ].join(" ")
  );

  if (initialHeal.status === "login_visible") {
    const loginResult = await waitForLoginComplete({
      data: {
        page,
        waitMs: loginWaitMs,
        pollMs: loginPollMs,
        urlBlocklist: ["login"]
      },
      deps
    });

    if (loginResult.status === "timeout") {
      throw createStageError(
        "login_refresh_timeout",
        `Login refresh timed out after ${loginWaitMs}ms.`,
        "E_LOGIN_REFRESH_TIMEOUT"
      );
    }

    logger.info(`Login state: ${loginResult.status}`);
    await saveCookies({
      data: { cookiesPath, page },
      deps
    });
  } else if (initialHeal.status === "target_not_found") {
    throw createStageError(
      "target_not_found_after_reload",
      "Target page not found after self-heal reload.",
      "E_TARGET_NOT_FOUND"
    );
  }

  const postHeal = initialHeal.status === "login_visible"
    ? await selfHealTargetPage({
        data: {
          page,
          targetUrl,
          navigationTimeoutMs
        },
        deps
      })
    : initialHeal;

  if (postHeal.status === "login_visible") {
    throw createStageError(
      "login_still_visible_after_recovery",
      "Login stayed visible after recovery.",
      "E_LOGIN_STILL_VISIBLE"
    );
  }

  if (postHeal.status === "target_not_found") {
    throw createStageError(
      "target_not_found_after_reload",
      "Target page not found after self-heal reload.",
      "E_TARGET_NOT_FOUND"
    );
  }

  const watchSignals = await probeWatchSignals({
    data: { page, targetUrl },
    deps
  });

  const targetStatus = await detectTargetStatus({
    data: {
      page,
      targetUrl,
      waitMs: navigationTimeoutMs
    },
    deps
  });

  logger.info(
    [
      "watchSignals",
      `ready=${watchSignals.pageReady ? 1 : 0}`,
      `loginLabel=${watchSignals.hasLoginLabel ? 1 : 0}`,
      `password=${watchSignals.hasPasswordField ? 1 : 0}`,
      `targetText=${watchSignals.hasTargetSearchText ? 1 : 0}`,
      `liveBadge=${watchSignals.hasLiveBadge ? 1 : 0}`
    ].join(" ")
  );
  logger.info(
    [
      "targetStatus",
      `status=${targetStatus.status}`,
      `found=${targetStatus.found ? 1 : 0}`,
      `live=${targetStatus.live ? 1 : 0}`
    ].join(" ")
  );

  if (targetStatus.status === "UNKNOWN") {
    throw createStageError(
      "status_probe_error",
      "Target status probe returned UNKNOWN.",
      "E_STATUS_PROBE"
    );
  }

  await saveCookies({
    data: { cookiesPath, page },
    deps
  });

  const title = await page.title().catch(() => "");

  return {
    cookiesLoaded: cookiesResult.loaded,
    healStatus: postHeal.status,
    watchSignals,
    targetStatus,
    title
  };
}
