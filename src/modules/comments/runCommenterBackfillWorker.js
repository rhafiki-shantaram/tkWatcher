import { focusRoomWindow } from "./focusRoomWindow.js";
import {
  markCommenterBackfillDeferred,
  claimCommenterBackfillBatch,
  markCommenterBackfillFailed,
  markCommenterBackfillResolved,
  patchCommenterBackfillRecords
} from "./commenterBackfillState.js";
import { isRoomCommentCaptureStateActive } from "./roomCommentCaptureState.js";
import { resolveCommentProfileBackground } from "./resolveCommentProfileBackground.js";
import {
  closeCommentPopover,
  isCommenterVisibleOnPage,
  revealCommenterProfilePopover,
  resolveProfileFromRoomNetworkSnapshot,
  upsertProfileCacheEntry
} from "./commenterBackfillWorkerHelpers.js";

/**
 * Drain queued commenters in the background.
 * @param {{ data?: object, deps: object, withFocusLock?: Function }} ctx
 * @returns {Promise<void>}
 */
export async function runCommenterBackfillWorker(ctx) {
  const { data = {}, deps, withFocusLock } = ctx;
  const { logger } = deps;
  const {
    roomState,
    roomHandle = "",
    roomUrl = "",
    batchSize = 2,
    backfillTickMs = 500,
    backfillWaitMs = 2500,
    backfillRetryDelayMs = 3000
  } = data;

  if (!roomState) {
    throw new Error("Missing roomState for commenter backfill worker.");
  }

  const acquireFocusLock = typeof withFocusLock === "function"
    ? withFocusLock
    : async (task) => task();

  logger.info(
    `commentBackfill:worker_start handle=${roomHandle || roomState.handle || "(unknown)"} url=${roomUrl || roomState.url || "(unknown)"}`
  );

  try {
    while (isRoomCommentCaptureStateActive(roomState) && !roomState.stopping) {
      const page = roomState.roomWindow && roomState.roomWindow.page
        ? roomState.roomWindow.page
        : null;

      if (!page || (typeof page.isClosed === "function" && page.isClosed())) {
        break;
      }

      const backfillState = roomState.commenterBackfillState;
      const batch = claimCommenterBackfillBatch({
        data: {
          state: backfillState,
          nowMs: Date.now(),
          batchSize
        }
      });

      if (!batch.length) {
        await sleep(backfillTickMs, deps);
        continue;
      }

      logger.info(
        [
          "commentBackfill:batch_start",
          `handle=${roomHandle || roomState.handle || "(unknown)"}`,
          `batchSize=${batch.length}`,
          `queueSize=${Array.isArray(backfillState?.queue) ? backfillState.queue.length : 0}`
        ].join(" ")
      );

      for (const task of batch) {
        if (!task || !task.entry || roomState.stopping || !isRoomCommentCaptureStateActive(roomState)) {
          continue;
        }

        const commenterName = String(task.entry.commentUserName || "").trim();
        if (!commenterName) {
          continue;
        }

        logger.info(
          [
            "commentBackfill:start",
            `handle=${roomHandle || roomState.handle || "(unknown)"}`,
            `commenter=${commenterName}`,
            `normalizedKey=${task.normalizedKey || "(unknown)"}`,
            `attempt=${Math.max(0, Number(task.entry?.attemptCount || 0)) + 1}`
          ].join(" ")
        );

        try {
          await acquireFocusLock(async () => {
            if (roomState.stopping || !isRoomCommentCaptureStateActive(roomState)) {
              return;
            }

            const visible = await isCommenterVisibleOnPage({
              data: {
                page,
                commenterName
              }
            });
            if (!visible) {
              const deferredEntry = markCommenterBackfillDeferred({
                data: {
                  state: roomState.commenterBackfillState,
                  normalizedKey: task.normalizedKey,
                  reason: "not_visible",
                  retryDelayMs: backfillRetryDelayMs,
                  nowMs: Date.now()
                }
              });
              logger.info(
                [
                  "commentBackfill:deferred",
                  `handle=${roomHandle || roomState.handle || "(unknown)"}`,
                  `commenter=${commenterName}`,
                  `status=${String(deferredEntry?.status || "pending")}`,
                  `nextAttemptAt=${Math.max(0, Number(deferredEntry?.nextAttemptAt || 0))}`
                ].join(" ")
              );
              return;
            }

            await closeCommentPopover({
              data: {
                page
              }
            });
            const resolvedProfile = await resolveCommentProfileBackground({
              data: {
                page,
                waitMs: backfillWaitMs,
                resolveProfileFromNetwork: async () => resolveProfileFromRoomNetworkSnapshot({
                  data: {
                    roomState,
                    commenterName
                  }
                }),
                revealPopover: async () => {
                  await closeCommentPopover({
                    data: {
                      page
                    }
                  });
                  const revealed = await revealCommenterProfilePopover({
                    data: {
                      page,
                      commenterName
                    }
                  });
                  if (!revealed) {
                    throw new Error(`Failed to reveal commenter popover for ${commenterName}`);
                  }
                }
              },
              deps
            });

            const profileName = String(resolvedProfile.profileName || "").trim();
            const profileHref = String(resolvedProfile.profileHref || "").trim();
            const profileSource = String(resolvedProfile.source || "backfill").trim() || "backfill";

            if (!profileName && !profileHref) {
              throw new Error(`Unable to resolve commenter profile for ${commenterName}`);
            }

            upsertProfileCacheEntry({
              data: {
                state: roomState.profileCacheState,
                commentUserName: commenterName,
                profileName: profileName || commenterName,
                profileHref,
                profileSource
              }
            });

            const resolvedEntry = markCommenterBackfillResolved({
              data: {
                state: roomState.commenterBackfillState,
                normalizedKey: task.normalizedKey,
                profileName: profileName || commenterName,
                profileHref,
                profileSource,
                resolvedAt: Date.now()
              }
            });
            const patchedRecords = patchCommenterBackfillRecords({
              data: {
                state: roomState.captureState,
                normalizedKey: task.normalizedKey,
                profileName: profileName || commenterName,
                profileHref,
                profileSource,
                updatedAt: Date.now()
              }
            });

            logger.info(
              [
                "commentBackfill:resolved",
                `handle=${roomHandle || roomState.handle || "(unknown)"}`,
                `commenter=${commenterName}`,
                `profileName=${String(resolvedEntry?.profileName || profileName || "").trim() || "(unknown)"}`,
                `profileHref=${String(resolvedEntry?.profileHref || profileHref || "").trim() || "(unknown)"}`,
                `profileSource=${String(resolvedEntry?.profileSource || profileSource || "backfill").trim() || "backfill"}`,
                `recordsUpdated=${Math.max(0, Number(patchedRecords?.updated || 0))}`
              ].join(" ")
            );
            for (const record of Array.isArray(patchedRecords?.records) ? patchedRecords.records : []) {
              logger.info(
                [
                  "commentRoom:comment_update",
                  `handle=${roomHandle || roomState.handle || "(unknown)"}`,
                  `commenter=${String(record.commentUserName || commenterName).trim() || "(unknown)"}`,
                  `commentKey=${String(record.commentKey || "").trim() || "(unknown)"}`,
                  `profileName=${String(record.profileName || profileName || "").trim() || "(unknown)"}`,
                  `profileHref=${String(record.profileHref || profileHref || "").trim() || "(unknown)"}`,
                  `profileSource=${String(record.profileSource || profileSource || "backfill").trim() || "backfill"}`
                ].join(" ")
              );
            }
          });
        } catch (error) {
          const failedEntry = markCommenterBackfillFailed({
            data: {
              state: roomState.commenterBackfillState,
              normalizedKey: task.normalizedKey,
              error,
              retryDelayMs: backfillRetryDelayMs,
              nowMs: Date.now()
            }
          });

          logger.info(
            [
              "commentBackfill:failed",
              `handle=${roomHandle || roomState.handle || "(unknown)"}`,
              `commenter=${commenterName}`,
              `attempts=${Math.max(0, Number(failedEntry?.attemptCount || 0))}`,
              `status=${String(failedEntry?.status || "failed")}`,
              `error=${error && typeof error === "object" ? (error.message || String(error)) : String(error)}`
            ].join(" ")
          );
        }
      }

      await sleep(backfillTickMs, deps);
    }
  } finally {
    logger.info(
      `commentBackfill:worker_stop handle=${roomHandle || roomState.handle || "(unknown)"}`
    );
  }
}

async function sleep(ms, deps) {
  await new Promise((resolve) => deps.setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}
