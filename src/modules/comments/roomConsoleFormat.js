/**
 * Format one lean terminal line for room lifecycle events.
 * @param {{ event: string, roomHandle?: string, roomUrl?: string, status?: string, reason?: string, streak?: number, threshold?: number, source?: string }} room
 * @returns {string}
 */
export function formatRoomConsoleLine(room) {
  const event = String(room?.event || "commentRoom:room").trim();
  const roomHandle = String(room?.roomHandle || "").trim();
  const roomUrl = String(room?.roomUrl || "").trim();
  const status = String(room?.status || "").trim();
  const reason = String(room?.reason || "").trim();
  const source = String(room?.source || "").trim();
  const streak = Number.isFinite(Number(room?.streak)) ? Math.max(0, Math.floor(Number(room?.streak))) : null;
  const threshold = Number.isFinite(Number(room?.threshold)) ? Math.max(0, Math.floor(Number(room?.threshold))) : null;

  return [
    event,
    `handle=${roomHandle || "(unknown)"}`,
    `url=${roomUrl || "(unknown)"}`,
    `status=${status || "(unknown)"}`,
    reason ? `reason=${reason}` : null,
    source ? `source=${source}` : null,
    streak !== null ? `streak=${streak}` : null,
    threshold !== null ? `threshold=${threshold}` : null
  ]
    .filter(Boolean)
    .join(" ");
}
