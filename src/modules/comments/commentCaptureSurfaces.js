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
        "Open commenter profile popovers when needed",
        "Read profile data from DOM or network fallback",
        "Persist comment capture rows"
      ],
      foregroundRequired: false,
      foregroundFallbackOnly: true
    },
    focusDependentSteps: [
      "OrderBot-style profile popover capture",
      "Any fallback step that TikTok only reveals after real tab focus"
    ],
    focusIndependentSteps: [
      "Live-room tab spawn and close",
      "Direct DOM reads from the live tab",
      "Network-backed profile extraction",
      "Status probing from the watcher tab"
    ],
    notes: [
      "Foreground should be a fallback, not the default capture path.",
      "Comment capture is layered on top of the existing logged-in watcher session."
    ]
  };
}
