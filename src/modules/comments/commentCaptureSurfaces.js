/**
 * Return the lean comment-capture surface map for the planned CDP refactor.
 * This is inventory only: no runtime behavior, no browser side effects.
 */
export function getCommentCaptureSurfaces() {
  return {
    watcherTab: {
      role: "watcher",
      responsibilities: [
        "Hold the logged-in TikTok target page",
        "Probe room status",
        "Spawn or retire capture tabs from status changes"
      ],
      foregroundRequired: false
    },
    captureTab: {
      role: "room",
      responsibilities: [
        "Observe live-room comment stream",
        "Read live comment rows directly from the room DOM",
        "Persist comment capture rows"
      ],
      foregroundRequired: false
    },
    focusDependentSteps: [
      "Room window launch and close validation"
    ],
    focusIndependentSteps: [
      "Live-room tab spawn and close",
      "Direct DOM reads from the live tab",
      "Status probing from the watcher tab"
    ],
    notes: [
      "Direct DOM capture is the only comment path.",
      "Comment capture is layered on top of the existing logged-in watcher session."
    ]
  };
}
