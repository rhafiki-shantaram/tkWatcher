import { captureRoomCommentsTick } from "./captureRoomCommentsTick.js";
import { detectRoomLiveEndedOverlay } from "./detectRoomLiveEndedOverlay.js";
import { focusRoomWindow } from "./focusRoomWindow.js";
import { probeRoomWindowFocus } from "./probeRoomWindowFocus.js";
import { inspectLiveRoomNavigation } from "./resolveLiveRoomUrl.js";
import {
  isRoomCommentCaptureStateActive,
  setRoomCommentCaptureFocusMissUntil,
  setRoomCommentCaptureNetworkSnapshot
} from "./roomCommentCaptureState.js";
import {
  resolveRoomCommentFocusCapturePolicy,
  resolveRoomCommentFocusProbePolicy,
  resolveRoomCommentNetworkPolicy
} from "./resolveRoomCommentCapturePolicy.js";

/**
 * Run the per-room capture worker.
 * @param {{ data?: object, deps: object, withFocusLock?: Function }} ctx
 * @returns {Promise<void>}
 */
export async function runRoomCommentCaptureWorker(ctx) {
  const { data = {}, deps, withFocusLock } = ctx;
  const { logger } = deps;
  const {
    roomState,
    roomHandle = "",
    roomUrl = "",
    onLiveEnded = null,
    onNonTargetNavigation = null,
    focusCooldownMs = 120000,
    roomTickMs = 500,
    urlWatchdogMs = 10000
  } = data;

  if (!roomState) {
    throw new Error("Missing roomState for room comment worker.");
  }

  const acquireFocusLock = typeof withFocusLock === "function"
    ? withFocusLock
    : async (task) => task();
  let urlWatchdogStopped = false;
  const roomHandleLabel = roomHandle || roomState.handle || "";

  const urlWatchdogPromise = (async () => {
    while (!urlWatchdogStopped && isRoomCommentCaptureStateActive(roomState) && !roomState.stopping) {
      await sleep(urlWatchdogMs, deps);
      if (urlWatchdogStopped || roomState.stopping || !isRoomCommentCaptureStateActive(roomState)) {
        break;
      }

      const stopped = await inspectRoomNavigationAndStop({
        data: {
          roomState,
          roomHandle: roomHandleLabel,
          onNonTargetNavigation,
          logger,
          source: "url_watchdog"
        },
        deps
      });
      if (stopped) {
        break;
      }
    }
  })().catch((error) => {
    logger.error(
      `commentRoom:url_watchdog_error handle=${roomHandleLabel || "(unknown)"} error=${error && typeof error === "object" ? (error.message || String(error)) : String(error)}`
    );
  });

  try {
    while (isRoomCommentCaptureStateActive(roomState) && !roomState.stopping) {
      if (!roomState.isLive) {
        await sleep(roomTickMs, deps);
        continue;
      }

      const roomPage = roomState.roomWindow.page;
      const roomUrlState = await inspectRoomNavigationAndStop({
        data: {
          roomState,
          roomHandle: roomHandleLabel,
          onNonTargetNavigation,
          logger,
          source: "worker_loop"
        }
      });
      if (roomUrlState.stopped) {
        return;
      }

      const liveEndedSignal = await detectRoomLiveEndedOverlay({
        data: {
          page: roomPage
        },
        deps
      });

      if (liveEndedSignal.ended) {
        if (!roomState.liveEndedDetected) {
          logger.info(
            `commentRoom:live_ended_detected handle=${roomHandle || roomState.handle || "(unknown)"} reason=${liveEndedSignal.reason} text=${liveEndedSignal.matchedText || ""}`
          );
        }
        roomState.liveEndedDetected = true;
        roomState.liveEndedSignal = liveEndedSignal;
        if (!roomState.liveEndedStopping) {
          roomState.liveEndedStopping = true;
          if (typeof onLiveEnded === "function") {
            await onLiveEnded({
              roomState,
              roomHandle: roomHandle || roomState.handle || "",
              liveEndedSignal
            });
          }
        }
        return;
      }

      const nowMs = Date.now();
      const focusProbePolicy = resolveRoomCommentFocusProbePolicy({
        data: {
          focusMissUntil: roomState.focusMissUntil,
          nowMs
        }
      });

      if (!focusProbePolicy.shouldProbe) {
        await sleep(roomTickMs, deps);
        continue;
      }

      const currentNetworkSnapshot = roomState.networkStream
        ? roomState.networkStream.snapshot()
        : null;
      const networkActivity = resolveRoomCommentNetworkPolicy({
        data: {
          snapshot: currentNetworkSnapshot,
          previousSnapshot: roomState.previousNetworkSnapshot
        }
      });
      setRoomCommentCaptureNetworkSnapshot(roomState, currentNetworkSnapshot, networkActivity);

      if (!networkActivity.active) {
        await sleep(roomTickMs, deps);
        continue;
      }

      await acquireFocusLock(async () => {
        if (roomState.stopping || !isRoomCommentCaptureStateActive(roomState) || !roomState.isLive) {
          return;
        }

        await focusRoomWindow({
          data: {
            page: roomPage
          }
        });

        const focusState = await probeRoomWindowFocus({
          data: {
            page: roomPage
          },
          deps
        });

        const focusCapturePolicy = resolveRoomCommentFocusCapturePolicy({
          data: {
            focusState,
            focusCooldownMs,
            nowMs: Date.now()
          }
        });

        if (!focusCapturePolicy.shouldCapture) {
          setRoomCommentCaptureFocusMissUntil(roomState, focusCapturePolicy.nextFocusMissUntil);
          return;
        }

        await captureRoomCommentsTick({
          data: {
            page: roomPage,
            roomHandle,
            roomUrl: roomState.lastKnownRoomUrl || roomState.url || roomUrl,
            captureState: roomState.captureState,
            commentPersistenceState: roomState.commentPersistenceState,
            focusState
          },
          deps
        });
      });

      await sleep(roomTickMs, deps);
    }
  } finally {
    urlWatchdogStopped = true;
    await urlWatchdogPromise;
  }
}

async function sleep(ms, deps) {
  await new Promise((resolve) => deps.setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

async function inspectRoomNavigationAndStop(ctx) {
  const { data = {} } = ctx || {};
  const {
    roomState,
    roomHandle = "",
    onNonTargetNavigation = null,
    logger,
    source = "worker_loop"
  } = data;

  if (!roomState || !roomState.roomWindow || !roomState.roomWindow.page) {
    return {
      stopped: false
    };
  }

  const roomPage = roomState.roomWindow.page;
  const currentRoomUrl = typeof roomPage.url === "function" ? roomPage.url() : "";
  if (currentRoomUrl) {
    roomState.lastKnownRoomUrl = currentRoomUrl;
  }

  const navigationSignal = inspectLiveRoomNavigation(currentRoomUrl, roomHandle || roomState.handle || "");
  if (!navigationSignal.isNonTargetLive) {
    return {
      stopped: false,
      navigationSignal
    };
  }

  if (!roomState.nonTargetNavigationDetected) {
    logger.info(
      `commentRoom:non_target_navigation_detected handle=${roomHandle || roomState.handle || "(unknown)"} expectedHandle=${navigationSignal.expectedHandle || roomHandle || roomState.handle || ""} currentHandle=${navigationSignal.matchedHandle || ""} currentUrl=${navigationSignal.matchedUrl || currentRoomUrl || ""} source=${source} ts=${Date.now()}`
    );
  }

  roomState.nonTargetNavigationDetected = true;
  roomState.nonTargetNavigationSignal = navigationSignal;
  if (typeof onNonTargetNavigation === "function" && !roomState.nonTargetNavigationStopping) {
    roomState.nonTargetNavigationStopping = true;
    await onNonTargetNavigation({
      roomState,
      roomHandle: roomHandle || roomState.handle || "",
      navigationSignal
    });
  }

  return {
    stopped: true,
    navigationSignal
  };
}
