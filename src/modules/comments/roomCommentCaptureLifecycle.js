import { launchRoomWindow } from "../browser/launchRoomWindow.js";
import { openRoomNetworkSignalStream } from "./openRoomNetworkSignalStream.js";
import {
  createRoomCommentCaptureSessionState,
  isRoomCommentCaptureStateActive,
  markRoomCommentCaptureLive,
  markRoomCommentCaptureNotLive,
  markRoomCommentCaptureStopping,
} from "./roomCommentCaptureState.js";
import { runRoomCommentCaptureWorker } from "./runRoomCommentCaptureWorker.js";

/**
 * Sync a single allowed room against the current live-room discovery result.
 * @param {{ data?: object, deps: object, withFocusLock?: Function }} ctx
 * @returns {Promise<object|null>}
 */
export async function syncRoomCommentCaptureSession(ctx) {
  const { data = {}, deps, withFocusLock } = ctx;
  const {
    handle = "",
    liveRoom = null,
    roomRegistry,
    boundaryRegistry,
    lifecycleTraceState = null,
    commentPersistenceState = null,
    cookiesPath = "",
    launchOptions = {},
    focusCooldownMs = 120000,
    roomTickMs = 500,
    notLiveStreakThreshold = 5
  } = data;
  const { logger } = deps;

  if (!roomRegistry || !roomRegistry.activeRooms || typeof roomRegistry.activeRooms.get !== "function") {
    throw new Error("Missing roomRegistry for comment live capture session.");
  }
  if (!boundaryRegistry || typeof boundaryRegistry.registerRoomWindow !== "function") {
    throw new Error("Missing boundaryRegistry for comment live capture session.");
  }

  let roomState = roomRegistry.activeRooms.get(handle) || null;
  const roomActive = isRoomCommentCaptureStateActive(roomState);

  if (!liveRoom) {
    clearRoomLaunchCooldown({
      data: {
        handle,
        lifecycleTraceState
      },
      deps
    });
    clearRoomLaunchFailureCooldown({
      data: {
        handle,
        lifecycleTraceState
      },
      deps
    });
  } else if (!roomActive) {
    const launchFailureCooldown = getRoomLaunchFailureCooldownState({
      data: {
        handle,
        lifecycleTraceState
      },
      deps
    });
    if (launchFailureCooldown.active) {
      logger.info(
        `commentRoom:launch_skipped handle=${handle || "(unknown)"} reason=launch_failure_cooldown remainingMs=${launchFailureCooldown.remainingMs} ts=${Date.now()}`
      );
      return roomState;
    }
    const roomLaunchCooldown = getRoomLaunchCooldownState({
      data: {
        handle,
        lifecycleTraceState
      },
      deps
    });
    if (roomLaunchCooldown.active) {
      logger.info(
        `commentRoom:launch_skipped handle=${handle || "(unknown)"} reason=live_ended_cooldown remainingMs=${roomLaunchCooldown.remainingMs} ts=${Date.now()}`
      );
      return roomState;
    }
    roomState = await startRoomCommentCaptureSession({
      data: {
        handle,
        liveRoom,
        roomRegistry,
        boundaryRegistry,
        lifecycleTraceState,
        commentPersistenceState,
        cookiesPath,
        launchOptions,
        focusCooldownMs,
        roomTickMs
      },
      deps,
      withFocusLock
    }).catch((error) => {
      recordRoomLaunchFailureCooldown({
        data: {
          handle,
          lifecycleTraceState,
          error
        },
        deps
      });
      logger.error(
        `commentRoom:launch_failed handle=${handle || "(unknown)"} reason=launch_failure error=${error && typeof error === "object" ? (error.message || String(error)) : String(error)} ts=${Date.now()}`
      );
      return null;
    });
  }

  roomState = roomRegistry.activeRooms.get(handle) || roomState;
  const refreshedActive = isRoomCommentCaptureStateActive(roomState);

  if (liveRoom && refreshedActive && roomState) {
    markRoomCommentCaptureLive(roomState, liveRoom.url);
    return roomState;
  }

  if (!liveRoom && refreshedActive && roomState) {
    markRoomCommentCaptureNotLive(roomState);

    if (roomState.notLiveStreak >= notLiveStreakThreshold) {
      await stopRoomCommentCaptureSession({
        data: {
          handle,
          roomState,
          roomRegistry,
          boundaryRegistry,
          lifecycleTraceState
        },
        deps
      });
    }
  }

  return roomState;
}

/**
 * Close all active room sessions best effort.
 * @param {{ data?: object, deps: object }} ctx
 * @returns {Promise<number>}
 */
export async function closeAllRoomCommentCaptureSessions(ctx) {
  const { data = {}, deps } = ctx;
  const { roomRegistry, boundaryRegistry, lifecycleTraceState = null } = data;

  if (!roomRegistry || !roomRegistry.activeRooms || typeof roomRegistry.activeRooms.values !== "function") {
    return 0;
  }
  if (!boundaryRegistry || typeof boundaryRegistry.removeRoomWindow !== "function") {
    return 0;
  }

  let closed = 0;
  for (const roomState of Array.from(roomRegistry.activeRooms.values())) {
    try {
      const stopped = await stopRoomCommentCaptureSession({
        data: {
          handle: roomState.handle,
          roomState,
          roomRegistry,
          boundaryRegistry,
          lifecycleTraceState
        },
        deps
      });
      if (stopped) {
        closed += 1;
      }
    } catch {
      // Best effort.
    }
  }

  return closed;
}

async function startRoomCommentCaptureSession(ctx) {
  const { data = {}, deps, withFocusLock } = ctx;
  const {
    handle = "",
    liveRoom = null,
    roomRegistry,
    boundaryRegistry,
    lifecycleTraceState = null,
    commentPersistenceState = null,
    cookiesPath = "",
    launchOptions = {},
    focusCooldownMs = 120000,
    roomTickMs = 500,
    requestWatcherRefresh = null
  } = data;
  const { logger } = deps;

  if (!handle) {
    throw new Error("Missing handle for comment live capture session.");
  }
  if (!liveRoom || !liveRoom.url) {
    throw new Error("Missing liveRoom for comment live capture session.");
  }

  const launchAttemptAtMs = Date.now();
  const launchOrigin = resolveRoomLaunchOrigin({
    data: {
      handle,
      lifecycleTraceState
    }
  });
  logger.info(
    `roomWindow:launch_attempt handle=${handle} origin=${launchOrigin} ts=${launchAttemptAtMs} url=${liveRoom.url}`
  );

  const roomWindow = await launchRoomWindow({
    data: {
      roomHandle: handle,
      roomUrl: liveRoom.url,
      cookiesPath,
      launchOptions: {
        ...launchOptions,
        navigationTimeoutMs: 120000
      }
    },
    deps
  });

  const networkStream = await openRoomNetworkSignalStream({
    data: {
      page: roomWindow.page,
      roomHandle: handle,
      roomUrl: liveRoom.url,
      remoteDebuggingPort: roomWindow.remoteDebuggingPort
    },
    deps
  });
  const roomState = createRoomCommentCaptureSessionState({
    data: {
      roomWindow,
      handle,
      url: liveRoom.url,
      liveRoomSource: liveRoom.source,
      userDataDir: roomWindow.userDataDir,
      remoteDebuggingPort: roomWindow.remoteDebuggingPort,
      networkStream,
      commentPersistenceState
    }
  });
  roomState.launchStartedAtMs = launchAttemptAtMs;
  roomState.launchOrigin = launchOrigin;
  roomState.launchCompletedAtMs = Date.now();
  clearRoomLaunchFailureCooldown({
    data: {
      handle,
      lifecycleTraceState
    },
    deps
  });

  roomRegistry.activeRooms.set(handle, roomState);
  boundaryRegistry.registerRoomWindow(handle, roomWindow.page, {
    role: "room",
    source: liveRoom.source,
    userDataDir: roomWindow.userDataDir,
    remoteDebuggingPort: roomWindow.remoteDebuggingPort
  });

  runRoomCommentCaptureWorker({
    data: {
      roomState,
      roomHandle: handle,
      roomUrl: liveRoom.url,
      onLiveEnded: async () => {
        await stopRoomCommentCaptureSession({
          data: {
            handle,
            roomState,
            roomRegistry,
            boundaryRegistry,
            closeReason: "live_ended_overlay",
            lifecycleTraceState
          },
          deps
        });
        if (typeof requestWatcherRefresh === "function") {
          await requestWatcherRefresh("live_ended_overlay");
        }
      },
      onNonTargetNavigation: async () => {
        roomState.closeReason = "non_target_navigation";
        await stopRoomCommentCaptureSession({
          data: {
            handle,
            roomState,
            roomRegistry,
            boundaryRegistry,
            closeReason: "non_target_navigation",
            lifecycleTraceState
          },
          deps
        });
      },
      focusCooldownMs,
      roomTickMs
    },
    deps,
    withFocusLock
  }).catch((error) => {
    logger.error(formatRoomWorkerError(error));
  });

  return roomState;
}

async function stopRoomCommentCaptureSession(ctx) {
  const { data = {}, deps } = ctx;
  const { logger } = deps;
  const {
    handle = "",
    roomState,
    roomRegistry,
    boundaryRegistry,
    closeReason: requestedCloseReason = "",
    lifecycleTraceState = null
  } = data;

  if (!roomState) {
    return false;
  }
  if (roomState.closePromise || roomState.closeCompletedAtMs > 0) {
    return false;
  }
  if (roomState.stopping && roomState.closeStartedAtMs > 0) {
    return false;
  }

  markRoomCommentCaptureStopping(roomState);
  const closeReason = String(requestedCloseReason || roomState.closeReason || "").trim()
    || (roomState.nonTargetNavigationDetected
      ? "non_target_navigation"
      : roomState.liveEndedDetected
        ? "live_ended_overlay"
        : "not_live");
  roomState.closeReason = closeReason;
  roomState.closeStartedAtMs = Date.now();
  roomState.closePromise = (async () => {
    const closingAtMs = roomState.closeStartedAtMs;
    logger.info(
      `commentRoom:room_closing handle=${handle || roomState.handle || "(unknown)"} reason=${closeReason} closeReason=${closeReason} liveEndedDetected=${roomState.liveEndedDetected ? "yes" : "no"} ts=${closingAtMs}${roomState.launchStartedAtMs ? ` launchAtMs=${roomState.launchStartedAtMs} liveMs=${Math.max(0, closingAtMs - roomState.launchStartedAtMs)}` : ""}`
    );
    await closeRoomNetworkStream(roomState.networkStream);
    await closeRoomWindow(roomState.roomWindow);
    logger.info(
      `roomWindow:close_done handle=${handle || roomState.handle || "(unknown)"} reason=${closeReason} closeReason=${closeReason} liveEndedDetected=${roomState.liveEndedDetected ? "yes" : "no"} ts=${Date.now()}${roomState.launchStartedAtMs ? ` launchAtMs=${roomState.launchStartedAtMs}` : ""}`
    );
    if (boundaryRegistry && typeof boundaryRegistry.removeRoomWindow === "function") {
      boundaryRegistry.removeRoomWindow(handle || roomState.handle);
    }
    if (roomRegistry && roomRegistry.activeRooms && typeof roomRegistry.activeRooms.delete === "function") {
      roomRegistry.activeRooms.delete(handle || roomState.handle);
    }
    const cooldownState = recordRoomLifecycleStop({
      data: {
        handle: handle || roomState.handle || "",
        reason: closeReason,
        closedAtMs: Date.now(),
        lifecycleTraceState
      }
    });
    if (cooldownState && cooldownState.cooldownSet) {
      logger.info(
        `commentRoom:launch_cooldown_set handle=${handle || roomState.handle || "(unknown)"} reason=${closeReason} cooldownMs=${cooldownState.cooldownMs} untilMs=${cooldownState.cooldownUntilMs} ts=${Date.now()}`
      );
    }
    logger.info(
      `commentRoom:room_closed handle=${handle || roomState.handle || "(unknown)"} reason=${closeReason} closeReason=${closeReason} liveEndedDetected=${roomState.liveEndedDetected ? "yes" : "no"} ts=${Date.now()}${roomState.launchStartedAtMs ? ` launchAtMs=${roomState.launchStartedAtMs}` : ""}`
    );
    return true;
  })();

  try {
    return await roomState.closePromise;
  } finally {
    roomState.closeCompletedAtMs = Date.now();
    roomState.closePromise = null;
  }
}

async function closeRoomWindow(roomState) {
  if (!roomState) {
    return false;
  }

  const roomWindow = roomState.roomWindow || roomState;

  if (roomWindow && typeof roomWindow.close === "function") {
    await roomWindow.close();
    return true;
  }

  if (roomWindow && roomWindow.browser && typeof roomWindow.browser.close === "function") {
    await roomWindow.browser.close();
    return true;
  }

  if (roomWindow && roomWindow.page && typeof roomWindow.page.close === "function") {
    await roomWindow.page.close();
    return true;
  }

  return false;
}

async function closeRoomNetworkStream(networkStream) {
  if (!networkStream || typeof networkStream.close !== "function") {
    return false;
  }

  await networkStream.close();
  return true;
}

function formatRoomWorkerError(error) {
  return error && typeof error === "object"
    ? `${error.message || String(error)} stage=${error.stage || "comment_room_worker"} code=${error.code || "E_COMMENT_ROOM_WORKER"}`
    : String(error);
}

function resolveRoomLaunchOrigin(ctx) {
  const { data = {} } = ctx || {};
  const {
    handle = "",
    lifecycleTraceState = null
  } = data;

  const lastStop = lifecycleTraceState && lifecycleTraceState.lastStopByHandle
    ? lifecycleTraceState.lastStopByHandle.get(handle)
    : null;
  if (lastStop && lastStop.reason === "live_ended_overlay") {
    return "post_live_ended_refresh";
  }
  if (lastStop && lastStop.reason === "non_target_navigation") {
    return "non_target_navigation_recovery";
  }
  if (lastStop && lastStop.reason === "not_live") {
    return "not_live_recovery";
  }
  return "first_discovery";
}

function recordRoomLifecycleStop(ctx) {
  const { data = {} } = ctx || {};
  const {
    handle = "",
    reason = "not_live",
    closedAtMs = Date.now(),
    lifecycleTraceState = null
  } = data;

  if (!lifecycleTraceState || !lifecycleTraceState.lastStopByHandle || typeof lifecycleTraceState.lastStopByHandle.set !== "function" || !handle) {
    return {
      cooldownSet: false
    };
  }

  lifecycleTraceState.lastStopByHandle.set(handle, {
    reason,
    closedAtMs: Math.max(0, Number(closedAtMs) || 0)
  });

  if (reason !== "live_ended_overlay" && reason !== "non_target_navigation") {
    return {
      cooldownSet: false
    };
  }

  if (!lifecycleTraceState.launchCooldownByHandle || typeof lifecycleTraceState.launchCooldownByHandle.set !== "function") {
    return {
      cooldownSet: false
    };
  }

  const cooldownMs = reason === "non_target_navigation"
    ? Math.max(1000, Number(lifecycleTraceState.nonTargetNavigationCooldownMs || 5000) || 5000)
    : Math.max(1000, Number(lifecycleTraceState.liveEndedCooldownMs || 5000) || 5000);
  const cooldownUntilMs = Math.max(0, Number(closedAtMs) || 0) + cooldownMs;
  lifecycleTraceState.launchCooldownByHandle.set(handle, {
    reason,
    closedAtMs: Math.max(0, Number(closedAtMs) || 0),
    cooldownUntilMs
  });

  return {
    cooldownSet: true,
    cooldownMs,
    cooldownUntilMs
  };
}

function getRoomLaunchCooldownState(ctx) {
  const { data = {}, deps } = ctx || {};
  const { handle = "", lifecycleTraceState = null } = data;
  const { logger } = deps || {};

  if (!handle || !lifecycleTraceState || !lifecycleTraceState.launchCooldownByHandle || typeof lifecycleTraceState.launchCooldownByHandle.get !== "function") {
    return {
      active: false,
      remainingMs: 0
    };
  }

  const cooldown = lifecycleTraceState.launchCooldownByHandle.get(handle);
  if (!cooldown) {
    return {
      active: false,
      remainingMs: 0
    };
  }

  const nowMs = Date.now();
  const remainingMs = Math.max(0, Number(cooldown.cooldownUntilMs || 0) - nowMs);
  if (remainingMs > 0) {
    return {
      active: true,
      remainingMs,
      cooldownUntilMs: cooldown.cooldownUntilMs
    };
  }

  lifecycleTraceState.launchCooldownByHandle.delete(handle);
  if (logger && typeof logger.info === "function") {
    logger.info(
      `commentRoom:launch_cooldown_cleared handle=${handle} reason=expired ts=${nowMs}`
    );
  }

  return {
    active: false,
    remainingMs: 0
  };
}

function clearRoomLaunchCooldown(ctx) {
  const { data = {}, deps } = ctx || {};
  const { handle = "", lifecycleTraceState = null } = data;
  const { logger } = deps || {};

  if (!handle || !lifecycleTraceState || !lifecycleTraceState.launchCooldownByHandle || typeof lifecycleTraceState.launchCooldownByHandle.delete !== "function") {
    return false;
  }

  if (!lifecycleTraceState.launchCooldownByHandle.has(handle)) {
    return false;
  }

  lifecycleTraceState.launchCooldownByHandle.delete(handle);
  if (logger && typeof logger.info === "function") {
    logger.info(`commentRoom:launch_cooldown_cleared handle=${handle} reason=not_live ts=${Date.now()}`);
  }
  return true;
}

function recordRoomLaunchFailureCooldown(ctx) {
  const { data = {}, deps } = ctx || {};
  const {
    handle = "",
    lifecycleTraceState = null,
    error = null
  } = data;
  const { logger } = deps || {};

  if (!handle || !lifecycleTraceState || !lifecycleTraceState.launchFailureCooldownByHandle || typeof lifecycleTraceState.launchFailureCooldownByHandle.set !== "function") {
    return {
      cooldownSet: false
    };
  }

  const cooldownMs = Math.max(10000, Number(lifecycleTraceState.launchFailureCooldownMs || 15000) || 15000);
  const failedAtMs = Date.now();
  const cooldownUntilMs = failedAtMs + cooldownMs;
  const errorMessage = error && typeof error === "object"
    ? (error.message || String(error))
    : String(error || "launch_failed");

  lifecycleTraceState.launchFailureCooldownByHandle.set(handle, {
    failedAtMs,
    cooldownUntilMs,
    errorMessage
  });

  if (logger && typeof logger.info === "function") {
    logger.info(
      `commentRoom:launch_failure_cooldown_set handle=${handle} cooldownMs=${cooldownMs} untilMs=${cooldownUntilMs} ts=${failedAtMs}`
    );
  }

  return {
    cooldownSet: true,
    cooldownMs,
    cooldownUntilMs
  };
}

function getRoomLaunchFailureCooldownState(ctx) {
  const { data = {}, deps } = ctx || {};
  const { handle = "", lifecycleTraceState = null } = data;
  const { logger } = deps || {};

  if (!handle || !lifecycleTraceState || !lifecycleTraceState.launchFailureCooldownByHandle || typeof lifecycleTraceState.launchFailureCooldownByHandle.get !== "function") {
    return {
      active: false,
      remainingMs: 0
    };
  }

  const cooldown = lifecycleTraceState.launchFailureCooldownByHandle.get(handle);
  if (!cooldown) {
    return {
      active: false,
      remainingMs: 0
    };
  }

  const nowMs = Date.now();
  const remainingMs = Math.max(0, Number(cooldown.cooldownUntilMs || 0) - nowMs);
  if (remainingMs > 0) {
    return {
      active: true,
      remainingMs,
      cooldownUntilMs: cooldown.cooldownUntilMs
    };
  }

  lifecycleTraceState.launchFailureCooldownByHandle.delete(handle);
  if (logger && typeof logger.info === "function") {
    logger.info(
      `commentRoom:launch_failure_cooldown_cleared handle=${handle} reason=expired ts=${nowMs}`
    );
  }

  return {
    active: false,
    remainingMs: 0
  };
}

function clearRoomLaunchFailureCooldown(ctx) {
  const { data = {}, deps } = ctx || {};
  const { handle = "", lifecycleTraceState = null } = data;
  const { logger } = deps || {};

  if (!handle || !lifecycleTraceState || !lifecycleTraceState.launchFailureCooldownByHandle || typeof lifecycleTraceState.launchFailureCooldownByHandle.delete !== "function") {
    return false;
  }

  if (!lifecycleTraceState.launchFailureCooldownByHandle.has(handle)) {
    return false;
  }

  lifecycleTraceState.launchFailureCooldownByHandle.delete(handle);
  if (logger && typeof logger.info === "function") {
    logger.info(`commentRoom:launch_failure_cooldown_cleared handle=${handle} reason=success_or_not_live ts=${Date.now()}`);
  }
  return true;
}
