export const runtimeEnvContract = [
  { key: "TIKTOK_URL", required: true, defaultValue: null, note: "Direct TikTok target URL." },
  {
    key: "TARGET_HANDLES",
    required: true,
    defaultValue: null,
    note: "Comma-separated live profile allowlist."
  },
  {
    key: "COOKIES_PATH",
    required: false,
    defaultValue: "cookies.json",
    note: "Cookie file used for session restore."
  },
  {
    key: "KEEP_ALIVE",
    required: false,
    defaultValue: false,
    note: "Keep the browser open after the run."
  },
  {
    key: "COMMENT_CAPTURE",
    required: false,
    defaultValue: false,
    note: "Start the live-room comment capture loop."
  },
  {
    key: "COMMENT_CAPTURE_STORAGE_ROOT",
    required: false,
    defaultValue: "C:\\tkWatcher\\data\\comments",
    note: "Local comment file root."
  },
  {
    key: "COMMENT_INGEST_ENABLED",
    required: false,
    defaultValue: false,
    note: "Reserved for future HTTP ingest re-enable."
  },
  {
    key: "CDP_REMOTE_DEBUGGING_PORT",
    required: false,
    defaultValue: null,
    note: "Expose a CDP endpoint on the launched browser."
  },
  {
    key: "NAVIGATION_TIMEOUT_MS",
    required: false,
    defaultValue: 120000,
    note: "Timeout for page navigation."
  },
  {
    key: "LOGIN_WAIT_MS",
    required: false,
    defaultValue: 120000,
    note: "Timeout for manual login recovery."
  },
  {
    key: "LOGIN_POLL_MS",
    required: false,
    defaultValue: 1500,
    note: "Polling interval while waiting for login."
  },
  {
    key: "COMMENT_INGEST_TEST_BASE_URL",
    required: false,
    defaultValue: "https://dev-sitex2082572611.wixdev-sites.org/",
    note: "Legacy HTTP ingest setting. Inactive while COMMENT_INGEST_ENABLED=false."
  },
  {
    key: "COMMENT_INGEST_PROD_BASE_URL",
    required: false,
    defaultValue: "",
    note: "Legacy HTTP ingest setting. Inactive while COMMENT_INGEST_ENABLED=false."
  },
  {
    key: "COMMENT_INGEST_PATH",
    required: false,
    defaultValue: "/_functions/commentIngestTest",
    note: "Legacy HTTP ingest setting. Inactive while COMMENT_INGEST_ENABLED=false."
  },
  {
    key: "COMMENT_INGEST_DRY_RUN",
    required: false,
    defaultValue: false,
    note: "Legacy HTTP ingest setting. Inactive while COMMENT_INGEST_ENABLED=false."
  }
];

export function readBoolEnv(value, fallback = false) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

export function readIntEnv(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function readStringEnv(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

export function readCsvEnv(value) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function normalizeTargetHandles(value) {
  const seen = new Set();
  const normalized = [];

  for (const handle of readCsvEnv(value)) {
    const lowered = handle.toLowerCase();
    if (!lowered || seen.has(lowered)) {
      continue;
    }
    seen.add(lowered);
    normalized.push(lowered);
  }

  return normalized;
}

export function readRuntimeEnv(env) {
  const targetHandles = normalizeTargetHandles(env.TARGET_HANDLES);

  return {
    tiktokUrl: readStringEnv(env.TIKTOK_URL),
    targetHandles,
    cookiesPath: readStringEnv(env.COOKIES_PATH, "cookies.json"),
    keepAlive: readBoolEnv(env.KEEP_ALIVE, false),
    commentCapture: readBoolEnv(env.COMMENT_CAPTURE, false),
    commentCaptureStorageRoot: readStringEnv(env.COMMENT_CAPTURE_STORAGE_ROOT, "C:\\tkWatcher\\data\\comments"),
    commentIngestEnabled: readBoolEnv(env.COMMENT_INGEST_ENABLED, false),
    cdpRemoteDebuggingPort: readIntEnv(env.CDP_REMOTE_DEBUGGING_PORT, null),
    navigationTimeoutMs: readIntEnv(env.NAVIGATION_TIMEOUT_MS, 120000),
    loginWaitMs: readIntEnv(env.LOGIN_WAIT_MS, 120000),
    loginPollMs: readIntEnv(env.LOGIN_POLL_MS, 1500),
    commentIngestTestBaseUrl: readStringEnv(env.COMMENT_INGEST_TEST_BASE_URL, "https://dev-sitex2082572611.wixdev-sites.org/"),
    commentIngestProdBaseUrl: readStringEnv(env.COMMENT_INGEST_PROD_BASE_URL),
    commentIngestPath: readStringEnv(env.COMMENT_INGEST_PATH, "/_functions/commentIngestTest"),
    commentIngestDryRun: readBoolEnv(env.COMMENT_INGEST_DRY_RUN, false)
  };
}

export function createRuntimeLaunchOptions(runtimeEnv) {
  const { cdpRemoteDebuggingPort = null, navigationTimeoutMs = 120000 } = runtimeEnv || {};

  return {
    remoteDebuggingPort: Number.isFinite(Number(cdpRemoteDebuggingPort)) && Number(cdpRemoteDebuggingPort) > 0
      ? Math.floor(Number(cdpRemoteDebuggingPort))
      : 0,
    navigationTimeoutMs: Number.isFinite(Number(navigationTimeoutMs)) && Number(navigationTimeoutMs) > 0
      ? Math.floor(Number(navigationTimeoutMs))
      : 120000
  };
}
