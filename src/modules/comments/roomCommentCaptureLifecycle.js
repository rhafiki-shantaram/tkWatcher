import { launchRoomWindow } from "../browser/launchRoomWindow.js";
import { openRoomNetworkSignalStream } from "./openRoomNetworkSignalStream.js";
import {
  createRoomCommentCaptureSessionState,
  isRoomCommentCaptureStateActive,
  markRoomCommentCaptureLive,
  markRoomCommentCaptureNotLive,
  markRoomCommentCaptureStopping,
  setRoomCommenterBackfillWorkerPromise,
  setRoomCommentCaptureWorkerPromise
} from "./roomCommentCaptureState.js";
import { runCommenterBackfillWorker } from "./runCommenterBackfillWorker.js";
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
    sharedProfileCacheState = null,
    sharedCommenterBackfillState = null,
    cookiesPath = "",
    launchOptions = {},
    focusCooldownMs = 120000,
    roomTickMs = 500,
    backfillBatchSize = 2,
    backfillTickMs = 500,
    backfillWaitMs = 2500,
    backfillRetryDelayMs = 3000,
    notLiveStreakThreshold = 5
  } = data;

  if (!roomRegistry || !roomRegistry.activeRooms || typeof roomRegistry.activeRooms.get !== "function") {
    throw new Error("Missing roomRegistry for comment live capture session.");
  }
  if (!boundaryRegistry || typeof boundaryRegistry.registerRoomWindow !== "function") {
    throw new Error("Missing boundaryRegistry for comment live capture session.");
  }

  let roomState = roomRegistry.activeRooms.get(handle) || null;
  const roomActive = isRoomCommentCaptureStateActive(roomState);

  if (liveRoom && !roomActive) {
    roomState = await startRoomCommentCaptureSession({
      data: {
        handle,
        liveRoom,
        roomRegistry,
        boundaryRegistry,
        sharedProfileCacheState,
        sharedCommenterBackfillState,
        cookiesPath,
        launchOptions,
        focusCooldownMs,
        roomTickMs,
        backfillBatchSize,
        backfillTickMs,
        backfillWaitMs,
        backfillRetryDelayMs
      },
      deps,
      withFocusLock
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
          boundaryRegistry
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
  const { roomRegistry, boundaryRegistry } = data;

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
          boundaryRegistry
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
    sharedProfileCacheState = null,
    sharedCommenterBackfillState = null,
    cookiesPath = "",
    launchOptions = {},
    focusCooldownMs = 120000,
    roomTickMs = 500,
    backfillBatchSize = 2,
    backfillTickMs = 500,
    backfillWaitMs = 2500,
    backfillRetryDelayMs = 3000,
    requestWatcherRefresh = null
  } = data;
  const { logger } = deps;

  if (!handle) {
    throw new Error("Missing handle for comment live capture session.");
  }
  if (!liveRoom || !liveRoom.url) {
    throw new Error("Missing liveRoom for comment live capture session.");
  }

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
      profileCacheState: sharedProfileCacheState,
      commenterBackfillState: sharedCommenterBackfillState
    }
  });

  roomRegistry.activeRooms.set(handle, roomState);
  boundaryRegistry.registerRoomWindow(handle, roomWindow.page, {
    role: "room",
    source: liveRoom.source,
    userDataDir: roomWindow.userDataDir,
    remoteDebuggingPort: roomWindow.remoteDebuggingPort
  });

  setRoomCommentCaptureWorkerPromise(roomState, runRoomCommentCaptureWorker({
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
              boundaryRegistry
            },
            deps
          });
          if (typeof requestWatcherRefresh === "function") {
            await requestWatcherRefresh("live_ended_overlay");
          }
        },
        focusCooldownMs,
        roomTickMs,
        backfillBatchSize,
        backfillTickMs,
        backfillWaitMs,
        backfillRetryDelayMs
      },
    deps,
    withFocusLock
  }).catch((error) => {
    logger.error(formatRoomWorkerError(error));
  }));

  setRoomCommenterBackfillWorkerPromise(roomState, runCommenterBackfillWorker({
    data: {
      roomState,
      roomHandle: handle,
      roomUrl: liveRoom.url,
      batchSize: backfillBatchSize,
      backfillTickMs,
      backfillWaitMs,
      backfillRetryDelayMs
    },
    deps,
    withFocusLock
  }).catch((error) => {
    logger.error(formatRoomWorkerError(error));
  }));

  return roomState;
}

async function stopRoomCommentCaptureSession(ctx) {
  const { data = {}, deps } = ctx;
  const { logger } = deps;
  const {
    handle = "",
    roomState,
    roomRegistry,
    boundaryRegistry
  } = data;

  if (!roomState) {
    return false;
  }
  if (roomState.stopping && (!roomRegistry || !roomRegistry.activeRooms || !roomRegistry.activeRooms.has(handle || roomState.handle))) {
    return false;
  }

  markRoomCommentCaptureStopping(roomState);
  logger.info(
    `commentRoom:room_closing handle=${handle || roomState.handle || "(unknown)"} reason=${roomState.liveEndedDetected ? "live_ended_overlay" : "not_live"}`
  );
  await closeRoomNetworkStream(roomState.networkStream);
  await closeRoomWindow(roomState.roomWindow);
  if (boundaryRegistry && typeof boundaryRegistry.removeRoomWindow === "function") {
    boundaryRegistry.removeRoomWindow(handle || roomState.handle);
  }
  if (roomRegistry && roomRegistry.activeRooms && typeof roomRegistry.activeRooms.delete === "function") {
    roomRegistry.activeRooms.delete(handle || roomState.handle);
  }
  logger.info(
    `commentRoom:room_closed handle=${handle || roomState.handle || "(unknown)"} reason=${roomState.liveEndedDetected ? "live_ended_overlay" : "not_live"}`
  );
  return true;
}

async function closeRoomWindow(roomState) {
  if (!roomState) {
    return false;
  }

  if (typeof roomState.close === "function") {
    await roomState.close();
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
