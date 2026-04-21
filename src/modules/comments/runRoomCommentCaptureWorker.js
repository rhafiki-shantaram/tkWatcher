import { captureRoomCommentsTick } from "./captureRoomCommentsTick.js";
import { focusRoomWindow } from "./focusRoomWindow.js";
import { probeRoomWindowFocus } from "./probeRoomWindowFocus.js";
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
  const {
    roomState,
    roomHandle = "",
    roomUrl = "",
    focusCooldownMs = 120000,
    roomTickMs = 500
  } = data;

  if (!roomState) {
    throw new Error("Missing roomState for room comment worker.");
  }

  const acquireFocusLock = typeof withFocusLock === "function"
    ? withFocusLock
    : async (task) => task();

  while (isRoomCommentCaptureStateActive(roomState) && !roomState.stopping) {
    if (!roomState.isLive) {
      await sleep(roomTickMs, deps);
      continue;
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

      const roomPage = roomState.roomWindow.page;
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
          roomUrl: roomState.url || roomUrl,
          captureState: roomState.captureState,
          focusState
        },
        deps
      });
    });

    await sleep(roomTickMs, deps);
  }
}

async function sleep(ms, deps) {
  await new Promise((resolve) => deps.setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}
