function normalizeStorageRoot(value, deps) {
  const { path } = deps || {};
  const root = String(value || "").trim() || "C:\\tkWatcher\\data\\comments";
  return path && typeof path.resolve === "function" ? path.resolve(root) : root;
}

function normalizeDateInput(value, deps) {
  const DateCtor = (deps && deps.Date) || Date;
  if (value instanceof DateCtor) {
    return value;
  }

  const candidate = value ? new DateCtor(value) : new DateCtor();
  return Number.isFinite(candidate.getTime()) ? candidate : new DateCtor();
}

function pad2(value) {
  return String(Math.max(0, Number(value) || 0)).padStart(2, "0");
}

function normalizeCommentKey(value) {
  return String(value || "").trim();
}

export function resolveCommentCaptureDateKey(date, deps) {
  const resolvedDate = normalizeDateInput(date, deps);
  const year = resolvedDate.getFullYear();
  const month = resolvedDate.getMonth() + 1;
  const day = resolvedDate.getDate();

  return `${String(year % 100).padStart(2, "0")}${pad2(month)}${pad2(day)}`;
}

export function resolveCommentCaptureArchiveMonthKeyFromDateKey(dateKey) {
  const normalized = String(dateKey || "").trim();
  if (!/^\d{6}$/.test(normalized)) {
    return "";
  }

  const year = 2000 + Number(normalized.slice(0, 2));
  const month = Number(normalized.slice(2, 4));
  const monthShorthands = [
    "jan",
    "feb",
    "mar",
    "apr",
    "may",
    "jun",
    "jul",
    "aug",
    "sep",
    "oct",
    "nov",
    "dec"
  ];

  if (!year || month < 1 || month > 12) {
    return "";
  }

  return `${year}${monthShorthands[month - 1] || "unk"}`;
}

function resolveCommentCaptureActiveDir(storageRoot, dateKey, deps) {
  const { path } = deps || {};
  const root = normalizeStorageRoot(storageRoot, deps);
  return path && typeof path.join === "function"
    ? path.join(root, String(dateKey || "").trim())
    : `${root}\\${String(dateKey || "").trim()}`;
}

function resolveCommentCaptureFilePath(storageRoot, dateKey, shopRoomCode, deps) {
  const { path } = deps || {};
  const roomCode = String(shopRoomCode || "").trim().toLowerCase();
  if (!roomCode) {
    return "";
  }

  const dir = resolveCommentCaptureActiveDir(storageRoot, dateKey, deps);
  return path && typeof path.join === "function"
    ? path.join(dir, `${roomCode}.txt`)
    : `${dir}\\${roomCode}.txt`;
}

async function appendCommentKey(filePath, commentKey, deps) {
  const { fs, path } = deps || {};
  if (!fs || !fs.promises) {
    throw new Error("Missing fs implementation for comment capture write.");
  }
  if (!path || typeof path.dirname !== "function") {
    throw new Error("Missing path implementation for comment capture write.");
  }

  const dir = path.dirname(filePath);
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.appendFile(filePath, `${normalizeCommentKey(commentKey)}\n`, "utf8");
}

/**
 * Create shared storage state for comment persistence.
 * @param {{ data?: object, deps: object }} ctx
 * @returns {{ storageRoot: string, writeChain: Promise<unknown> }}
 */
export function createCommentCaptureStorageState(ctx) {
  const { data = {}, deps } = ctx || {};
  const {
    storageRoot = "C:\\tkWatcher\\data\\comments"
  } = data;

  return {
    storageRoot: normalizeStorageRoot(storageRoot, deps),
    writeChain: Promise.resolve()
  };
}

/**
 * Persist one captured comment key into room-day text.
 * @param {{ data?: object, deps: object }} ctx
 * @returns {Promise<{ saved: boolean, skipped?: boolean, reason?: string, filePath?: string, dateKey?: string, shopRoomCode?: string }>}
 */
export async function persistCommentCaptureComment(ctx) {
  const { data = {}, deps } = ctx || {};
  const {
    storageState,
    comment
  } = data;

  if (!storageState || typeof storageState !== "object") {
    throw new Error("Missing storageState for comment persistence.");
  }
  if (!comment || typeof comment !== "object") {
    throw new Error("Missing comment for comment persistence.");
  }
  if (!String(comment.shopRoomCode || "").trim()) {
    return {
      saved: false,
      skipped: true,
      reason: "missing_shop_room_code"
    };
  }

  const prior = storageState.writeChain || Promise.resolve();
  const run = prior.catch(() => {}).then(() =>
    persistCommentCaptureCommentNow({
      data: {
        storageState,
        comment
      },
      deps
    })
  );

  storageState.writeChain = run.catch(() => {});
  return await run;
}

async function persistCommentCaptureCommentNow(ctx) {
  const { data = {}, deps } = ctx || {};
  const { storageState, comment } = data;
  const now = normalizeDateInput(undefined, deps);
  const dateKey = resolveCommentCaptureDateKey(now, deps);
  const filePath = resolveCommentCaptureFilePath(
    storageState.storageRoot,
    dateKey,
    comment.shopRoomCode,
    deps
  );

  await appendCommentKey(filePath, comment.commentKeyWithTimestamp || comment.commentKey, deps);

  return {
    saved: true,
    filePath,
    dateKey,
    shopRoomCode: String(comment.shopRoomCode || "").trim()
  };
}
