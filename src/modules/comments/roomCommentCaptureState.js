import { createRoomCommentCaptureState } from "./captureRoomCommentsTick.js";

/**
 * Create the full active room capture state record.
 * @param {{ data?: object }} ctx
 * @returns {object}
 */
export function createRoomCommentCaptureSessionState(ctx) {
  const { data = {} } = ctx || {};
  const {
    roomWindow,
    handle = "",
    url = "",
    liveRoomSource = "",
    userDataDir = "",
    remoteDebuggingPort = 0,
    networkStream = null
  } = data;

  return {
    roomWindow: roomWindow || null,
    handle,
    url,
    liveRoomSource,
    isLive: true,
    notLiveStreak: 0,
    focusMissUntil: 0,
    captureState: createRoomCommentCaptureState(),
    profileCacheState: data.profileCacheState || null,
    commenterBackfillState: data.commenterBackfillState || null,
    liveEndedDetected: false,
    liveEndedSignal: null,
    liveEndedStopping: false,
    userDataDir,
    remoteDebuggingPort,
    networkStream,
    previousNetworkSnapshot: null,
    networkActivity: null,
    stopping: false,
    commenterBackfillWorkerPromise: null,
    workerPromise: null
  };
}

export function markRoomCommentCaptureLive(roomState, liveRoomUrl) {
  if (!roomState) {
    return roomState;
  }

  roomState.isLive = true;
  roomState.url = String(liveRoomUrl || roomState.url || "");
  roomState.notLiveStreak = 0;
  roomState.liveEndedDetected = false;
  roomState.liveEndedSignal = null;
  roomState.liveEndedStopping = false;
  return roomState;
}

export function markRoomCommentCaptureNotLive(roomState) {
  if (!roomState) {
    return roomState;
  }

  roomState.isLive = false;
  roomState.notLiveStreak = Math.max(0, Number(roomState.notLiveStreak || 0)) + 1;
  return roomState;
}

export function setRoomCommentCaptureFocusMissUntil(roomState, focusMissUntil) {
  if (!roomState) {
    return roomState;
  }

  roomState.focusMissUntil = Math.max(0, Number(focusMissUntil || 0));
  return roomState;
}

export function setRoomCommentCaptureNetworkSnapshot(roomState, snapshot, networkActivity) {
  if (!roomState) {
    return roomState;
  }

  roomState.previousNetworkSnapshot = snapshot || null;
  roomState.networkActivity = networkActivity || null;
  return roomState;
}

export function markRoomCommentCaptureStopping(roomState) {
  if (!roomState) {
    return roomState;
  }

  roomState.stopping = true;
  return roomState;
}

export function setRoomCommentCaptureWorkerPromise(roomState, workerPromise) {
  if (!roomState) {
    return roomState;
  }

  roomState.workerPromise = workerPromise || null;
  return roomState;
}

export function setRoomCommenterBackfillWorkerPromise(roomState, workerPromise) {
  if (!roomState) {
    return roomState;
  }

  roomState.commenterBackfillWorkerPromise = workerPromise || null;
  return roomState;
}

export function isRoomCommentCaptureStateActive(roomState) {
  if (!roomState) {
    return false;
  }
  if (!roomState.roomWindow || !roomState.roomWindow.page || typeof roomState.roomWindow.page.isClosed !== "function") {
    return false;
  }
  return !roomState.roomWindow.page.isClosed();
}
