/**
 * Classify room network activity from the passive CDP stream snapshot.
 * Pure network policy: no focus changes, no DOM capture changes.
 * @param {{ data?: object }} ctx
 * @returns {{ active: boolean, kind: string, reason: string, signals: string[], matched: string[] }}
 */
export function classifyRoomNetworkActivity(ctx) {
  const { data = {} } = ctx;
  const { snapshot, previousSnapshot } = data;
  const events = Array.isArray(snapshot?.events) ? snapshot.events : [];
  const previousCount = Number(previousSnapshot?.events?.length || 0);
  const currentCount = Number(events.length || 0);
  const delta = Math.max(0, currentCount - previousCount);
  const matched = [];

  for (const event of events) {
    const text = normalizeEventText(event);
    if (text.includes("webcast/room/check_alive")) {
      matched.push("check_alive");
    }
    if (text.includes("livesdk_")) {
      matched.push("livesdk");
    }
    if (text.includes("webcastchatmessage")) {
      matched.push("WebcastChatMessage");
    }
    if (text.includes("comment")) {
      matched.push("comment");
    }
    if (text.includes("chat")) {
      matched.push("chat");
    }
    if (text.includes("msg_type")) {
      matched.push("msg_type");
    }
  }

  const uniqueMatched = Array.from(new Set(matched));
  const explicitCommentSignal = uniqueMatched.some((signal) =>
    signal === "WebcastChatMessage" || signal === "comment" || signal === "chat" || signal === "msg_type"
  );
  const heartbeatSignal = uniqueMatched.some((signal) => signal === "check_alive" || signal === "livesdk");

  if (explicitCommentSignal) {
    return {
      active: true,
      kind: "explicit_comment",
      reason: "network_comment_payload_hint",
      signals: uniqueMatched,
      matched: uniqueMatched
    };
  }

  if (heartbeatSignal || delta > 0) {
    return {
      active: true,
      kind: "activity",
      reason: heartbeatSignal ? "network_room_heartbeat" : "network_event_delta",
      signals: uniqueMatched,
      matched: uniqueMatched
    };
  }

  return {
    active: false,
    kind: "idle",
    reason: "network_idle",
    signals: uniqueMatched,
    matched: uniqueMatched
  };
}

function normalizeEventText(event) {
  if (!event || typeof event !== "object") {
    return "";
  }

  return [
    event.event,
    event.url,
    event.method,
    event.type,
    event.mimeType,
    event.payloadSample
  ]
    .map((value) => String(value || "").toLowerCase())
    .join(" ");
}
