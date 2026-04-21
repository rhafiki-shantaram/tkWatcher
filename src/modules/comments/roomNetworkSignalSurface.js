/**
 * Return the lean CDP network signal surface for room activity detection.
 * Inventory only: no CDP wiring, no browser side effects, no capture behavior.
 */
export function getRoomNetworkSignalSurface() {
  return {
    roomWindow: {
      role: "room",
      networkScope: "dedicated-room-browser-window",
      cdpEvents: [
        "Network.requestWillBeSent",
        "Network.responseReceived",
        "Network.webSocketFrameReceived"
      ],
      activitySignals: [
        "Repeated webcast/room/check_alive hits",
        "Bursts of livesdk_* telemetry",
        "Websocket payloads with comment/chat/msg_type hints",
        "Any payload that mentions WebcastChatMessage"
      ],
      notSignals: [
        "Watcher page traffic",
        "DOM comment scraping",
        "Foreground state as the primary signal"
      ],
      notes: [
        "Use network as a trigger, not the final source of comment text.",
        "Keep watcher network out of room capture scope.",
        "If no explicit comment payload appears, fall back to activity-only detection."
      ]
    },
    watcherWindow: {
      role: "watcher",
      networkScope: "excluded",
      notes: [
        "Watcher stays separate from room network capture.",
        "Watcher owns live-room discovery and room launch decisions."
      ]
    }
  };
}
