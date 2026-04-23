import { probeWatchSignals } from "./probeWatchSignals.js";
import { createStageError } from "./stageError.js";

/**
 * Self-heal one target page with a single reload retry.
 * @param {{ data?: object, deps: object }} ctx
 * @returns {Promise<{ status: string, signals: object }>}
 */
export async function selfHealTargetPage(ctx) {
  const { data = {}, deps } = ctx;
  const {
    page,
    targetUrl = "",
    navigationTimeoutMs = 120000
  } = data;
  const { logger } = deps;

  if (!page) {
    throw new Error("Missing page for self-heal.");
  }

  await waitForPageComplete({
    data: { page, timeoutMs: Math.min(navigationTimeoutMs, 15000) },
    deps
  });

  let signals = await probeWatchSignals({
    data: { page, targetUrl },
    deps
  });

  if (signals.hasLoginLabel || signals.hasPasswordField) {
    logger.info("selfHeal:login_visible");
    return { status: "login_visible", signals };
  }

  logger.info(
    signals.hasPageError
      ? "selfHeal:page_error_reload_once"
      : "selfHeal:freshness_reload_once"
  );
  try {
    await page.reload({
      waitUntil: "load",
      timeout: navigationTimeoutMs
    });
  } catch {
    throw createStageError(
      "target_reload_timeout",
      "Target reload timed out.",
      "E_TARGET_RELOAD_TIMEOUT"
    );
  }

  await waitForPageComplete({
    data: { page, timeoutMs: Math.min(navigationTimeoutMs, 15000) },
    deps
  });

  signals = await probeWatchSignals({
    data: { page, targetUrl },
    deps
  });

  if (signals.hasLoginLabel || signals.hasPasswordField) {
    logger.info("selfHeal:login_visible_after_reload");
    return { status: "login_visible", signals };
  }

  if (signals.hasPageError) {
    logger.info("selfHeal:page_error_after_reload");
    return { status: "page_error", signals };
  }

  if (signals.hasTargetSearchText) {
    logger.info("selfHeal:target_found_after_reload");
    return { status: "healthy_after_reload", signals };
  }

  logger.info("selfHeal:target_not_found_after_reload");
  return { status: "target_not_found", signals };
}

async function waitForPageComplete(ctx) {
  const { data = {}, deps } = ctx;
  const { page, timeoutMs = 15000 } = data;
  const { logger } = deps;

  try {
    await page.waitForFunction(() => document.readyState === "complete", {
      timeout: timeoutMs
    });
  } catch {
    throw createStageError(
      "page_load_timeout",
      "Page did not reach complete state in time.",
      "E_PAGE_LOAD_TIMEOUT"
    );
  }

  try {
    await page.waitForNetworkIdle({ idleTime: 1000, timeout: timeoutMs });
  } catch {
    // Best effort.
  }

  logger.info("selfHeal:page_ready");
}
