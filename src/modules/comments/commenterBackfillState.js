/**
 * Create shared commenter backfill state.
 * @param {{ data?: object }} ctx
 * @returns {{ byUserName: Map<string, object>, queue: string[], queuedKeys: Set<string>, activeKeys: Set<string> }}
 */
export function createCommenterBackfillState(ctx) {
  void ctx;

  return {
    byUserName: new Map(),
    queue: [],
    queuedKeys: new Set(),
    activeKeys: new Set(),
    failedCacheTtlMs: 600000
  };
}

/**
 * Queue or refresh an unresolved commenter for later enrichment.
 * @param {{ data?: object }} ctx
 * @returns {{ queued: boolean, entry: object|null, normalizedKey: string }}
 */
export function queueCommenterBackfillCandidate(ctx) {
  const { data = {} } = ctx || {};
  const {
    state = null,
    commentUserName = "",
    profileName = "",
    profileHref = "",
    profileSource = "",
    seenAt = Date.now(),
    nowMs = Date.now()
  } = data;

  const normalizedKey = normalizeCommenterBackfillKey(commentUserName);
  if (!state || !state.byUserName || !normalizedKey) {
    return {
      queued: false,
      entry: null,
      normalizedKey
    };
  }

  const normalizedCommentUserName = String(commentUserName || "").trim();
  const normalizedProfileName = String(profileName || "").trim();
  const normalizedProfileHref = String(profileHref || "").trim();
  const normalizedProfileSource = String(profileSource || "").trim() || "fallback";
  const profileIsComplete = isCommenterProfileComplete({
    profileName: normalizedProfileName,
    profileHref: normalizedProfileHref
  });
  const currentTime = Math.max(0, Number(nowMs) || Date.now());
  let entry = state.byUserName.get(normalizedKey) || null;
  const existingStatus = String(entry?.status || "");
  const existingFailedUntil = Math.max(0, Number(entry?.failedUntil || 0));

  if (!entry && profileIsComplete) {
    return {
      queued: false,
      entry: null,
      normalizedKey
    };
  }

  if (!entry) {
    entry = {
      commentUserName: normalizedCommentUserName,
      normalizedKey,
      firstSeenAt: seenAt,
      lastSeenAt: seenAt,
      lastAttemptAt: 0,
      nextAttemptAt: 0,
      attemptCount: 0,
      failedUntil: 0,
      maxAttempts: 3,
      profileName: normalizedProfileName,
      profileHref: normalizedProfileHref,
      profileSource: normalizedProfileSource,
      status: "pending"
    };
    state.byUserName.set(normalizedKey, entry);
  } else {
    entry.commentUserName = normalizedCommentUserName || String(entry.commentUserName || "").trim();
    entry.lastSeenAt = Math.max(0, Number(seenAt) || 0) || Date.now();
    if (normalizedProfileName) {
      entry.profileName = normalizedProfileName;
    }
    if (normalizedProfileHref) {
      entry.profileHref = normalizedProfileHref;
    }
    if (normalizedProfileSource) {
      entry.profileSource = normalizedProfileSource;
    }
    entry.nextAttemptAt = Math.max(0, Number(entry.nextAttemptAt || 0));
    if (profileIsComplete) {
      removeQueuedCommenterBackfillKey(state, normalizedKey);
      entry.status = "done";
      entry.failedUntil = 0;
      return {
        queued: false,
        entry,
        normalizedKey
      };
    }
    if (existingStatus === "failed" && existingFailedUntil > currentTime) {
      return {
        queued: false,
        entry,
        normalizedKey
      };
    }
    if (existingStatus === "failed" && existingFailedUntil <= currentTime) {
      entry.status = "pending";
      entry.attemptCount = 0;
      entry.failedUntil = 0;
      entry.nextAttemptAt = 0;
      entry.lastError = "";
    }
    if (entry.status !== "working") {
      entry.status = profileIsComplete ? "done" : "pending";
    }
  }

  queueCommenterBackfillKey(state, normalizedKey);
  entry.status = "pending";
  return {
    queued: true,
    entry,
    normalizedKey
  };
}

/**
 * Claim up to a batch of commenters for background backfill.
 * @param {{ data?: object }} ctx
 * @returns {Array<{ normalizedKey: string, entry: object }>}
 */
export function claimCommenterBackfillBatch(ctx) {
  const { data = {} } = ctx || {};
  const {
    state = null,
    nowMs = Date.now(),
    batchSize = 1
  } = data;

  if (!state || !Array.isArray(state.queue) || state.queue.length === 0) {
    return [];
  }

  const claimed = [];
  const maxBatchSize = Math.max(1, Math.floor(Number(batchSize) || 1));
  const currentTime = Math.max(0, Number(nowMs) || Date.now());

  for (let idx = 0; idx < state.queue.length && claimed.length < maxBatchSize;) {
    const normalizedKey = String(state.queue[idx] || "").trim();
    if (!normalizedKey) {
      state.queue.splice(idx, 1);
      continue;
    }

    const entry = state.byUserName.get(normalizedKey) || null;
    if (!entry) {
      removeQueuedCommenterBackfillKey(state, normalizedKey);
      continue;
    }

    let status = String(entry.status || "pending");
    const nextAttemptAt = Math.max(0, Number(entry.nextAttemptAt || 0));
    const attemptCount = Math.max(0, Number(entry.attemptCount || 0));
    const maxAttempts = Math.max(1, Math.floor(Number(entry.maxAttempts || 3) || 3));
    const failedUntil = Math.max(0, Number(entry.failedUntil || 0));

    if (status === "failed") {
      if (failedUntil > currentTime) {
        idx += 1;
        continue;
      }
      entry.status = "pending";
      entry.attemptCount = 0;
      entry.failedUntil = 0;
      entry.nextAttemptAt = 0;
      entry.lastError = "";
      status = "pending";
    }

    if (status !== "pending" || nextAttemptAt > currentTime || attemptCount >= maxAttempts) {
      if (attemptCount >= maxAttempts && status !== "failed") {
        entry.status = "failed";
        entry.failedUntil = currentTime + Math.max(0, Number(state.failedCacheTtlMs) || 0);
        removeQueuedCommenterBackfillKey(state, normalizedKey);
      }
      idx += 1;
      continue;
    }

    state.queue.splice(idx, 1);
    state.queuedKeys.delete(normalizedKey);
    state.activeKeys.add(normalizedKey);
    entry.status = "working";
    entry.lastAttemptAt = currentTime;
    claimed.push({
      normalizedKey,
      entry
    });
  }

  return claimed;
}

/**
 * Mark a commenter as resolved and remove it from the active set.
 * @param {{ data?: object }} ctx
 * @returns {object|null}
 */
export function markCommenterBackfillResolved(ctx) {
  const { data = {} } = ctx || {};
  const {
    state = null,
    normalizedKey = "",
    profileName = "",
    profileHref = "",
    profileSource = "",
    resolvedAt = Date.now()
  } = data;

  if (!state || !normalizedKey) {
    return null;
  }

  const entry = state.byUserName.get(normalizedKey) || null;
  if (!entry) {
    state.activeKeys?.delete?.(normalizedKey);
    return null;
  }

  entry.profileName = String(profileName || entry.profileName || "").trim();
  entry.profileHref = String(profileHref || entry.profileHref || "").trim();
  entry.profileSource = String(profileSource || entry.profileSource || "backfill").trim() || "backfill";
  entry.status = "done";
  entry.resolvedAt = Math.max(0, Number(resolvedAt) || Date.now());
  entry.failedUntil = 0;
  state.activeKeys.delete(normalizedKey);
  state.queuedKeys.delete(normalizedKey);
  return entry;
}

/**
 * Mark a commenter as failed and requeue with backoff when eligible.
 * @param {{ data?: object }} ctx
 * @returns {object|null}
 */
export function markCommenterBackfillFailed(ctx) {
  const { data = {} } = ctx || {};
  const {
    state = null,
    normalizedKey = "",
    error = null,
    retryDelayMs = 2000,
    nowMs = Date.now()
  } = data;

  if (!state || !normalizedKey) {
    return null;
  }

  const entry = state.byUserName.get(normalizedKey) || null;
  if (!entry) {
    state.activeKeys?.delete?.(normalizedKey);
    return null;
  }

  const attemptCount = Math.max(0, Number(entry.attemptCount || 0)) + 1;
  const maxAttempts = Math.max(1, Math.floor(Number(entry.maxAttempts || 3) || 3));
  entry.attemptCount = attemptCount;
  entry.lastError = String(error && error.message ? error.message : error || "");
  entry.lastAttemptAt = Math.max(0, Number(nowMs) || Date.now());
  state.activeKeys.delete(normalizedKey);

  if (attemptCount >= maxAttempts) {
    entry.status = "failed";
    entry.nextAttemptAt = 0;
    entry.failedUntil = entry.lastAttemptAt + Math.max(0, Number(state.failedCacheTtlMs) || 0);
    state.queuedKeys.delete(normalizedKey);
    return entry;
  }

  entry.status = "pending";
  entry.nextAttemptAt = entry.lastAttemptAt + Math.max(0, Number(retryDelayMs) || 0);
  queueCommenterBackfillKey(state, normalizedKey);
  return entry;
}

/**
 * Defer a commenter when the row is not currently visible.
 * @param {{ data?: object }} ctx
 * @returns {object|null}
 */
export function markCommenterBackfillDeferred(ctx) {
  const { data = {} } = ctx || {};
  const {
    state = null,
    normalizedKey = "",
    reason = "not_visible",
    retryDelayMs = 2000,
    nowMs = Date.now()
  } = data;

  if (!state || !normalizedKey) {
    return null;
  }

  const entry = state.byUserName.get(normalizedKey) || null;
  if (!entry) {
    return null;
  }

  const currentTime = Math.max(0, Number(nowMs) || Date.now());
  entry.status = "pending";
  entry.lastError = String(reason || "not_visible");
  entry.lastAttemptAt = currentTime;
  entry.nextAttemptAt = currentTime + Math.max(0, Number(retryDelayMs) || 0);
  state.activeKeys.delete(normalizedKey);
  queueCommenterBackfillKey(state, normalizedKey);
  return entry;
}

/**
 * Register an emitted comment record for later reconciliation.
 * @param {{ data?: object }} ctx
 * @returns {object|null}
 */
export function registerCommenterBackfillRecord(ctx) {
  const { data = {} } = ctx || {};
  const {
    state = null,
    commentKey = "",
    commentUserName = "",
    text = "",
    profileName = "",
    profileHref = "",
    profileSource = "",
    emittedAt = Date.now()
  } = data;

  if (!state || !commentKey) {
    return null;
  }

  if (!state.byCommentKey || typeof state.byCommentKey.set !== "function") {
    state.byCommentKey = new Map();
  }
  if (!state.commentKeysByUserName || typeof state.commentKeysByUserName.set !== "function") {
    state.commentKeysByUserName = new Map();
  }

  const normalizedKey = normalizeCommenterBackfillKey(commentUserName);
  const record = state.byCommentKey.get(commentKey) || {
    commentKey,
    commentUserName: String(commentUserName || "").trim(),
    normalizedKey,
    text: String(text || "").trim(),
    profileName: "",
    profileHref: "",
    profileSource: "",
    emittedAt: Math.max(0, Number(emittedAt) || Date.now()),
    updatedAt: Math.max(0, Number(emittedAt) || Date.now())
  };

  record.commentUserName = String(commentUserName || record.commentUserName || "").trim();
  record.normalizedKey = normalizedKey;
  record.text = String(text || record.text || "").trim();
  record.emittedAt = Math.max(0, Number(record.emittedAt || emittedAt) || Date.now());
  record.updatedAt = Math.max(0, Number(emittedAt) || Date.now());
  record.profileName = String(profileName || record.profileName || "").trim();
  record.profileHref = String(profileHref || record.profileHref || "").trim();
  record.profileSource = String(profileSource || record.profileSource || "").trim();

  state.byCommentKey.set(commentKey, record);
  addCommentKeyToUserIndex(state, normalizedKey, commentKey);
  return record;
}

/**
 * Patch in-memory records for a commenter.
 * @param {{ data?: object }} ctx
 * @returns {{ updated: number, records: object[] }}
 */
export function patchCommenterBackfillRecords(ctx) {
  const { data = {} } = ctx || {};
  const {
    state = null,
    normalizedKey = "",
    profileName = "",
    profileHref = "",
    profileSource = "backfill",
    updatedAt = Date.now()
  } = data;

  if (!state || !normalizedKey || !state.byCommentKey || !state.commentKeysByUserName) {
    return {
      updated: 0,
      records: []
    };
  }

  const commentKeys = state.commentKeysByUserName.get(normalizedKey) || new Set();
  const records = [];
  let updated = 0;

  for (const commentKey of commentKeys) {
    const record = state.byCommentKey.get(commentKey) || null;
    if (!record) {
      continue;
    }
    const before = `${record.profileName || ""}|${record.profileHref || ""}|${record.profileSource || ""}`;
    record.profileName = String(profileName || record.profileName || "").trim();
    record.profileHref = String(profileHref || record.profileHref || "").trim();
    record.profileSource = String(profileSource || record.profileSource || "backfill").trim() || "backfill";
    record.updatedAt = Math.max(0, Number(updatedAt) || Date.now());
    const after = `${record.profileName || ""}|${record.profileHref || ""}|${record.profileSource || ""}`;
    if (before !== after) {
      updated += 1;
    }
    records.push({ ...record });
  }

  return {
    updated,
    records
  };
}

export function normalizeCommenterBackfillKey(value) {
  return String(value || "").trim().toLowerCase();
}

function isCommenterProfileComplete(ctx) {
  const { profileName = "", profileHref = "" } = ctx || {};
  return !!(String(profileName || "").trim() && String(profileHref || "").trim());
}

function queueCommenterBackfillKey(state, normalizedKey) {
  if (!state.queuedKeys || typeof state.queuedKeys.add !== "function") {
    state.queuedKeys = new Set();
  }
  if (!state.activeKeys || typeof state.activeKeys.add !== "function") {
    state.activeKeys = new Set();
  }
  if (!Array.isArray(state.queue)) {
    state.queue = [];
  }
  if (state.queuedKeys.has(normalizedKey) || state.activeKeys.has(normalizedKey)) {
    return;
  }

  state.queuedKeys.add(normalizedKey);
  state.queue.push(normalizedKey);
}

function removeQueuedCommenterBackfillKey(state, normalizedKey) {
  if (!state.queuedKeys || typeof state.queuedKeys.delete !== "function") {
    state.queuedKeys = new Set();
  }
  if (!state.activeKeys || typeof state.activeKeys.delete !== "function") {
    state.activeKeys = new Set();
  }
  if (Array.isArray(state.queue) && state.queue.length > 0) {
    const queueIndex = state.queue.indexOf(normalizedKey);
    if (queueIndex >= 0) {
      state.queue.splice(queueIndex, 1);
    }
  }
  state.queuedKeys.delete(normalizedKey);
  state.activeKeys.delete(normalizedKey);
}

function addCommentKeyToUserIndex(state, normalizedKey, commentKey) {
  if (!normalizedKey || !commentKey) {
    return;
  }
  if (!state.commentKeysByUserName || typeof state.commentKeysByUserName.set !== "function") {
    state.commentKeysByUserName = new Map();
  }
  const existing = state.commentKeysByUserName.get(normalizedKey) || new Set();
  existing.add(commentKey);
  state.commentKeysByUserName.set(normalizedKey, existing);
}
