import { classifyRoomNetworkActivity } from "./classifyRoomNetworkActivity.js";

/**
 * Resolve whether room network state is worth advancing toward capture.
 * @param {{ data?: object }} ctx
 * @returns {{ active: boolean, kind: string, reason: string, signals: string[], matched: string[] }}
 */
export function resolveRoomCommentNetworkPolicy(ctx) {
  const { data = {} } = ctx;
  const { snapshot, previousSnapshot } = data;

  return classifyRoomNetworkActivity({
    data: {
      snapshot,
      previousSnapshot
    }
  });
}

/**
 * Resolve whether a room should attempt focus probing yet.
 * @param {{ data?: object }} ctx
 * @returns {{ shouldProbe: boolean, reason: string }}
 */
export function resolveRoomCommentFocusProbePolicy(ctx) {
  const { data = {} } = ctx;
  const {
    focusMissUntil = 0,
    nowMs = Date.now()
  } = data;

  if (Number(focusMissUntil || 0) > 0 && nowMs < Number(focusMissUntil || 0)) {
    return {
      shouldProbe: false,
      reason: "focus_cooldown"
    };
  }

  return {
    shouldProbe: true,
    reason: "focus_probe_allowed"
  };
}

/**
 * Resolve whether a focused room is ready for comment capture.
 * @param {{ data?: object }} ctx
 * @returns {{ shouldCapture: boolean, nextFocusMissUntil: number, reason: string }}
 */
export function resolveRoomCommentFocusCapturePolicy(ctx) {
  const { data = {} } = ctx;
  const {
    focusState,
    focusCooldownMs = 120000,
    nowMs = Date.now()
  } = data;

  const focused = !!focusState?.focused;
  const visible = String(focusState?.visibilityState || "").trim() === "visible";

  if (focused && visible) {
    return {
      shouldCapture: true,
      nextFocusMissUntil: 0,
      reason: "focus_ready"
    };
  }

  return {
    shouldCapture: false,
    nextFocusMissUntil: nowMs + Math.max(0, Number(focusCooldownMs) || 0),
    reason: focused ? "room_not_visible" : "room_not_focused"
  };
}
