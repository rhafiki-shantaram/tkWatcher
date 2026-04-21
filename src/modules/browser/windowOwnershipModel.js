/**
 * Return the lean window ownership model for the multi-window refactor.
 * Inventory only: no browser side effects, no runtime scheduling.
 */
export function getWindowOwnershipModel() {
  return {
    watcherWindow: {
      role: "watcher",
      surface: "main-browser-window",
      owns: [
        "Logged-in TikTok target page",
        "Live-room discovery on the search page",
        "Room status probing",
        "Room launch decisions"
      ],
      doesNotOwn: [
        "Per-room comment capture",
        "Per-room profile popover scraping",
        "Room lifecycle teardown"
      ],
      foregroundRequired: false
    },
    roomWindow: {
      role: "room",
      surface: "dedicated-browser-window-or-process",
      owns: [
        "One allowed live room",
        "Comment capture state",
        "Comment persistence and console emission",
        "Any room-specific fallback capture steps"
      ],
      doesNotOwn: [
        "Watcher live discovery",
        "Other room windows",
        "Global login/session bootstrap"
      ],
      foregroundRequired: "unknown",
      foregroundAsTestVariable: true
    },
    ownershipRules: [
      "One watcher window stays separate from all room windows.",
      "One active allowed room maps to one room window.",
      "Room windows may be foregrounded independently during validation.",
      "Capture should prefer background-safe mechanisms, but window focus remains the test variable."
    ],
    refactorIntent: [
      "Use separate browser windows or browser processes to test the TikTok focus gate.",
      "Keep the existing logged-in watcher session intact.",
      "Keep comment capture layered on top of the existing room lifecycle logic."
    ]
  };
}
