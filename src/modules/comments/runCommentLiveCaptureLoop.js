import { createTabSessionManager } from "../browser/createTabSessionManager.js";
import { detectTargetStatus } from "../browser/detectTargetStatus.js";
import { createCommentCaptureStageError } from "./commentCaptureStageError.js";
import {
  captureRoomCommentsTick,
  createRoomCommentCaptureState
} from "./captureRoomCommentsTick.js";
import { resolveLiveRoomUrl } from "./resolveLiveRoomUrl.js";
import { formatRoomConsoleLine } from "./roomConsoleFormat.js";

/**
 * Run a lean live-room tab lifecycle loop off watcher status changes.
 * @param {{ data?: object, deps: object }} ctx
 * @returns {Promise<object>}
 */
export async function runCommentLiveCaptureLoop(ctx) {
  const { data = {}, deps } = ctx;
  const {
    browser,
    watcherPage,
    targetUrl = "",
    targetHandles = [],
    pollMs = 60000,
    notLiveStreakThreshold = 5,
    roomTabName = "comment-room"
  } = data;
  const { logger } = deps;

  if (!browser) {
    throw new Error("Missing browser for comment live capture loop.");
  }
  if (!watcherPage) {
    throw new Error("Missing watcherPage for comment live capture loop.");
  }

  const tabSession = createTabSessionManager({
    data: { browser },
    deps
  });

  const roomRegistry = {
    activeRoom: null,
    notLiveStreak: 0
  };
  const roomCaptureState = createRoomCommentCaptureState();
  const allowedHandles = new Set(
    String(targetHandles || "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean)
  );

  logger.info(
    formatRoomConsoleLine({
      event: "commentRoom:init",
      status: "boot",
      streak: 0,
      threshold: notLiveStreakThreshold
    })
  );

  while (!watcherPage.isClosed()) {
    const statusResult = await detectTargetStatus({
      data: { page: watcherPage, targetUrl },
      deps
    });
    const status = String(statusResult.status || "UNKNOWN");
    if (watcherPage.isClosed()) {
      throw createCommentCaptureStageError(
        "comment_watcher_page_closed",
        "Watcher page closed mid loop.",
        "E_COMMENT_WATCHER_PAGE_CLOSED"
      );
    }
    const liveRoomUrl = await resolveLiveRoomUrl({
      data: {
        page: watcherPage,
        targetUrl
      },
      deps
    });

    if (status === "LIVE") {
      roomRegistry.notLiveStreak = 0;

      const activePage = roomRegistry.activeRoom?.page || null;
      const needsOpen = !activePage || activePage.isClosed?.();
      if (needsOpen) {
        if (!liveRoomUrl.url || !liveRoomUrl.handle) {
          logger.info(
            [
              "commentRoom:live_detected",
              "roomUrl=missing",
              `source=${liveRoomUrl.source}`,
              `status=${status}`
            ].join(" ")
          );
          throw createCommentCaptureStageError(
            "comment_room_url_missing",
            "Live room URL missing after LIVE status.",
            "E_COMMENT_ROOM_URL_MISSING"
          );
        } else if (allowedHandles.size && !allowedHandles.has(liveRoomUrl.handle)) {
          if (roomRegistry.activeRoom?.handle === liveRoomUrl.handle) {
            try {
              await tabSession.closeTab(roomTabName);
            } catch {
              // Best effort.
            }
            roomRegistry.activeRoom = null;
          }
          await new Promise((resolve) => deps.setTimeout(resolve, pollMs));
          continue;
        } else {
          const page = await tabSession.openTab(roomTabName, {
            url: liveRoomUrl.url,
            waitUntil: "load",
            timeoutMs: 120000,
            meta: {
              role: "room",
              targetUrl,
              targetHandle: liveRoomUrl.handle,
              status
            }
          });
          roomRegistry.activeRoom = {
            name: roomTabName,
            page,
            url: liveRoomUrl.url,
            handle: liveRoomUrl.handle,
            openedAtMs: Date.now()
          };
          logger.info(
            formatRoomConsoleLine({
              event: "commentRoom:opened",
              roomHandle: liveRoomUrl.handle,
              roomUrl: liveRoomUrl.url,
              status,
              source: liveRoomUrl.source
            })
          );
        }
      } else {
        if (activePage.isClosed?.()) {
          roomRegistry.activeRoom = null;
          throw createCommentCaptureStageError(
            "comment_capture_tab_closed",
            "Comment capture tab closed mid-loop.",
          "E_COMMENT_CAPTURE_TAB_CLOSED"
          );
        }
        logger.info(
          formatRoomConsoleLine({
            event: "commentRoom:active",
            roomHandle: roomRegistry.activeRoom.handle || "",
            roomUrl: roomRegistry.activeRoom.url || "",
            status
          })
        );
        await captureRoomCommentsTick({
          data: {
            page: activePage,
            roomHandle: roomRegistry.activeRoom.handle || "",
            roomUrl: roomRegistry.activeRoom.url || "",
            captureState: roomCaptureState
          },
          deps
        });
      }
    } else if (status === "NOT_LIVE") {
      roomRegistry.notLiveStreak += 1;
      logger.info(
        formatRoomConsoleLine({
          event: "commentRoom:not_live",
          roomHandle: roomRegistry.activeRoom?.handle || liveRoomUrl.handle || "",
          roomUrl: roomRegistry.activeRoom?.url || liveRoomUrl.url || "",
          status,
          streak: roomRegistry.notLiveStreak,
          threshold: notLiveStreakThreshold
        })
      );

      if (roomRegistry.notLiveStreak >= notLiveStreakThreshold && roomRegistry.activeRoom) {
        await tabSession.closeTab(roomTabName);
        roomRegistry.activeRoom = null;
        roomRegistry.notLiveStreak = 0;
        logger.info(
          formatRoomConsoleLine({
            event: "commentRoom:closed",
            roomHandle: liveRoomUrl.handle,
            roomUrl: liveRoomUrl.url,
            status,
            reason: "not_live_streak",
            threshold: notLiveStreakThreshold
          })
        );
      }
    } else {
      logger.info(
        formatRoomConsoleLine({
          event: "commentRoom:hold",
          roomHandle: roomRegistry.activeRoom?.handle || liveRoomUrl.handle || "",
          roomUrl: roomRegistry.activeRoom?.url || liveRoomUrl.url || "",
          status,
          streak: roomRegistry.notLiveStreak,
          threshold: notLiveStreakThreshold
        })
      );
    }

    await new Promise((resolve) => deps.setTimeout(resolve, pollMs));
  }

  if (roomRegistry.activeRoom) {
    try {
      await tabSession.closeTab(roomTabName);
    } catch {
      // Best effort.
    }
  }

  return {
    activeRoom: !!roomRegistry.activeRoom,
    notLiveStreak: roomRegistry.notLiveStreak,
    tabs: tabSession.listTabs()
  };
}
