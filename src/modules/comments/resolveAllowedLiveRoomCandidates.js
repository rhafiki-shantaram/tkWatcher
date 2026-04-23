import { resolveLiveRoomCandidates } from "./resolveLiveRoomCandidates.js";

/**
 * Resolve live room candidates for the allowed handle list.
 * Discovery only; no room-window close or stop authority here.
 * @param {{ data?: object, deps: object }} ctx
 * @returns {Promise<Map<string, { handle: string, url: string, source: string }>>}
 */
export async function resolveAllowedLiveRoomCandidates(ctx) {
  const { data = {}, deps } = ctx;
  const { page, allowedHandles = [] } = data;

  const allowedHandleList = normalizeAllowedHandles(allowedHandles);
  if (!page || !allowedHandleList.length) {
    return new Map();
  }

  const candidates = await resolveLiveRoomCandidates({
    data: {
      page
    },
    deps
  });

  const allowedHandleSet = new Set(allowedHandleList);
  const liveByHandle = new Map();

  for (const candidate of candidates) {
    if (!candidate || !candidate.handle || !candidate.url) {
      continue;
    }
    if (!allowedHandleSet.has(candidate.handle)) {
      continue;
    }

    liveByHandle.set(candidate.handle, candidate);
  }

  return liveByHandle;
}

function normalizeAllowedHandles(allowedHandles) {
  if (Array.isArray(allowedHandles)) {
    return allowedHandles
      .map((entry) => String(entry || "").trim().toLowerCase())
      .filter(Boolean);
  }

  return String(allowedHandles || "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}
