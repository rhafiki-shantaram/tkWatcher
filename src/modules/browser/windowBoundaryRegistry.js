/**
 * Track which page belongs to watcher and which pages belong to rooms.
 * This keeps the watcher surface out of the capture surface by contract.
 * @param {{ data?: object }} ctx
 * @returns {{
 *   watcherPage: any,
 *   isWatcherPage: Function,
 *   registerRoomWindow: Function,
 *   getRoomWindow: Function,
 *   listRoomWindows: Function,
 *   removeRoomWindow: Function
 * }}
 */
export function createWindowBoundaryRegistry(ctx) {
  const { data = {} } = ctx;
  const { watcherPage = null } = data;
  const roomWindows = new Map();

  function isWatcherPage(page) {
    return !!page && page === watcherPage;
  }

  function registerRoomWindow(handle, page, meta = {}) {
    if (!handle) {
      throw new Error("Missing room handle for room window registry.");
    }
    if (!page) {
      throw new Error(`Missing page for room window ${handle}.`);
    }
    if (isWatcherPage(page)) {
      throw new Error("Watcher page cannot be registered as a room window.");
    }

    const windowState = {
      handle: String(handle),
      page,
      meta: { ...meta },
      createdAtMs: Date.now()
    };

    roomWindows.set(windowState.handle, windowState);
    return windowState;
  }

  function getRoomWindow(handle) {
    return roomWindows.get(String(handle)) || null;
  }

  function listRoomWindows() {
    return Array.from(roomWindows.values()).map((windowState) => ({
      handle: windowState.handle,
      meta: { ...windowState.meta },
      createdAtMs: windowState.createdAtMs,
      isClosed: !!windowState.page?.isClosed?.()
    }));
  }

  function removeRoomWindow(handle) {
    return roomWindows.delete(String(handle));
  }

  return {
    watcherPage,
    isWatcherPage,
    registerRoomWindow,
    getRoomWindow,
    listRoomWindows,
    removeRoomWindow
  };
}
