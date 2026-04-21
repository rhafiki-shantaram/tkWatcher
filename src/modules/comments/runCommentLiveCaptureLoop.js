import { createWindowBoundaryRegistry } from "../browser/windowBoundaryRegistry.js";
import { createCommentCaptureStageError } from "./commentCaptureStageError.js";
import { createCommenterBackfillState } from "./commenterBackfillState.js";
import { closeAllRoomCommentCaptureSessions, syncRoomCommentCaptureSession } from "./roomCommentCaptureLifecycle.js";
import { resolveAllowedLiveRoomCandidates } from "./resolveAllowedLiveRoomCandidates.js";

/**
 * Run live-room watchers with one worker per active room.
 * @param {{ data?: object, deps: object }} ctx
 * @returns {Promise<object>}
 */
export async function runCommentLiveCaptureLoop(ctx) {
  const { data = {}, deps } = ctx;
  const {
    watcherPage,
    targetHandles = [],
    cookiesPath = "",
    launchOptions = {},
    notLiveStreakThreshold = 5,
  } = data;

  if (!watcherPage) {
    throw new Error("Missing watcherPage for comment live capture loop.");
  }

  const boundaryRegistry = createWindowBoundaryRegistry({
    data: { watcherPage },
    deps
  });

  const roomRegistry = {
    activeRooms: new Map()
  };
  const sharedProfileCacheState = {
    byUserName: new Map()
  };
  const sharedCommenterBackfillState = createCommenterBackfillState();
  const allowedHandleList = normalizeAllowedHandles(targetHandles);
  const discoveryPollMs = 1000;
  const heartbeatMs = 300000;
  const roomTickMs = 500;
  const focusCooldownMs = 120000;
  const withFocusLock = createFocusLock();
  const requestWatcherRefresh = createWatcherRefreshRequester({
    data: {
      page: watcherPage,
      refreshCooldownMs: 5000,
      navigationTimeoutMs: 120000
    },
    deps
  });
  let nextHeartbeatAt = Date.now() + heartbeatMs;

  while (!watcherPage.isClosed()) {
    if (watcherPage.isClosed()) {
      throw createCommentCaptureStageError(
        "comment_watcher_page_closed",
        "Watcher page closed mid loop.",
        "E_COMMENT_WATCHER_PAGE_CLOSED"
      );
    }

    const liveByHandle = await resolveAllowedLiveRoomCandidates({
      data: {
        page: watcherPage,
        allowedHandles: allowedHandleList
      },
      deps
    });

    for (const handle of allowedHandleList) {
      await syncRoomCommentCaptureSession({
        data: {
          handle,
          liveRoom: liveByHandle.get(handle) || null,
          roomRegistry,
          boundaryRegistry,
          sharedProfileCacheState,
          sharedCommenterBackfillState,
          cookiesPath,
          launchOptions,
          focusCooldownMs,
          roomTickMs,
          notLiveStreakThreshold,
          requestWatcherRefresh
        },
        deps,
        withFocusLock
      });
    }

    await maybeRunWatcherHeartbeat({
      data: {
        requestWatcherRefresh,
        nextHeartbeatAt,
        heartbeatMs
      },
      deps
    }).then((updatedNextHeartbeatAt) => {
      nextHeartbeatAt = updatedNextHeartbeatAt;
    });

    await sleep(discoveryPollMs, deps);
  }

  await closeAllRoomCommentCaptureSessions({
    data: {
      roomRegistry,
      boundaryRegistry
    },
    deps
  });

  return {
    activeRooms: roomRegistry.activeRooms.size,
    roomWindows: boundaryRegistry.listRoomWindows()
  };
}

function createFocusLock() {
  let chain = Promise.resolve();

  return async function withFocusLock(task) {
    const run = chain.then(() => task(), () => task());
    chain = run.catch(() => {});
    return run;
  };
}

async function sleep(ms, deps) {
  await new Promise((resolve) => deps.setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function normalizeAllowedHandles(targetHandles) {
  return String(targetHandles || "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function createWatcherRefreshRequester(ctx) {
  const { data = {}, deps } = ctx;
  const {
    page,
    refreshCooldownMs = 5000,
    navigationTimeoutMs = 120000
  } = data;
  const { logger } = deps;
  let inFlight = null;
  let lastRefreshAt = 0;

  return async function requestWatcherRefresh(reason = "live_ended") {
    if (!page || typeof page.reload !== "function" || typeof page.isClosed !== "function") {
      return false;
    }
    if (page.isClosed()) {
      return false;
    }
    if (inFlight) {
      return inFlight;
    }

    const nowMs = Date.now();
    if (lastRefreshAt > 0 && nowMs - lastRefreshAt < Math.max(0, Number(refreshCooldownMs) || 0)) {
      logger.info(
        `commentWatcher:refresh_skipped reason=${reason} cooldownMs=${Math.max(0, Number(refreshCooldownMs) || 0)}`
      );
      return false;
    }

    lastRefreshAt = nowMs;
    inFlight = (async () => {
      logger.info(`commentWatcher:refresh_start reason=${reason}`);
      try {
        await page.reload({
          waitUntil: "load",
          timeout: navigationTimeoutMs
        });
        logger.info(`commentWatcher:refresh_done reason=${reason}`);
        return true;
      } catch (error) {
        logger.error(
          `commentWatcher:refresh_failed reason=${reason} error=${error && typeof error === "object" ? (error.message || String(error)) : String(error)}`
        );
        return false;
      } finally {
        inFlight = null;
      }
    })();

    return inFlight;
  };
}

async function maybeRunWatcherHeartbeat(ctx) {
  const { data = {}, deps } = ctx;
  const {
    requestWatcherRefresh,
    nextHeartbeatAt = 0,
    heartbeatMs = 300000
  } = data;

  if (typeof requestWatcherRefresh !== "function") {
    return nextHeartbeatAt;
  }

  const nowMs = Date.now();
  if (nowMs < Number(nextHeartbeatAt || 0)) {
    return nextHeartbeatAt;
  }

  await requestWatcherRefresh("heartbeat");
  return Date.now() + Math.max(0, Number(heartbeatMs) || 0);
}
