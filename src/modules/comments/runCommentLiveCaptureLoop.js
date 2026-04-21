import { createWindowBoundaryRegistry } from "../browser/windowBoundaryRegistry.js";
import { createCommentCaptureStageError } from "./commentCaptureStageError.js";
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
  const allowedHandleList = normalizeAllowedHandles(targetHandles);
  const discoveryPollMs = 1000;
  const roomTickMs = 500;
  const focusCooldownMs = 120000;
  const withFocusLock = createFocusLock();

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
          cookiesPath,
          launchOptions,
          focusCooldownMs,
          roomTickMs,
          notLiveStreakThreshold
        },
        deps,
        withFocusLock
      });
    }

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
