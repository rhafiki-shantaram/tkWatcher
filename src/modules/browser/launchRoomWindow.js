import { launchBrowser } from "./launchBrowser.js";
import { loadCookies } from "./loadCookies.js";
import { selfHealTargetPage } from "./selfHealTargetPage.js";
import net from "node:net";

/**
 * Launch a dedicated browser window/process for one live room.
 * @param {{ data?: object, deps: object }} ctx
 * @returns {Promise<{ browser: any, page: any, wsEndpoint: string, roomHandle: string, roomUrl: string, userDataDir: string }>}
 */
export async function launchRoomWindow(ctx) {
  const { data = {}, deps } = ctx;
  const {
    roomHandle = "",
    roomUrl = "",
    cookiesPath = "",
    launchOptions = {}
  } = data;
  const { logger, path, process } = deps;

  if (!roomHandle) {
    throw new Error("Missing roomHandle for room window launch.");
  }

  const userDataDir = launchOptions.userDataDir || getDefaultRoomUserDataDir({
    path,
    process,
    roomHandle
  });
  const navigationTimeoutMs = readPositiveInt(launchOptions.navigationTimeoutMs, 120000);
  const remoteDebuggingPort = await resolveRoomRemoteDebuggingPort({
    launchOptions,
    process
  });
  let launchResult = null;

  try {
    launchResult = await launchBrowser({
      data: {
        launchOptions: {
          ...launchOptions,
          remoteDebuggingPort,
          userDataDir
        }
      },
      deps
    });

    if (cookiesPath) {
      await launchResult.page.goto("about:blank", {
        waitUntil: "load",
        timeout: navigationTimeoutMs
      });
      await loadCookies({
        data: {
          cookiesPath,
          page: launchResult.page
        },
        deps
      });
    }

    if (roomUrl) {
      await launchResult.page.goto(roomUrl, {
        waitUntil: "load",
        timeout: navigationTimeoutMs
      });
    }

    const healResult = await selfHealTargetPage({
      data: {
        page: launchResult.page,
        targetUrl: roomUrl,
        navigationTimeoutMs
      },
      deps
    });
    const surfaceResult = await ensureRoomCommentSurfaceReady({
      data: {
        page: launchResult.page,
        roomUrl,
        navigationTimeoutMs,
        surfaceWaitMs: 5000
      },
      deps
    });
    const launchedAtMs = Date.now();

    logger.info(
      `roomWindow:launched handle=${roomHandle} ts=${launchedAtMs} cdpPort=${remoteDebuggingPort} userDataDir=${userDataDir}${cookiesPath ? ` cookiesPath=${cookiesPath}` : ""}${roomUrl ? ` url=${roomUrl}` : ""} heal=${healResult.status} surface=${surfaceResult.status}`
    );

    return {
      ...launchResult,
      roomHandle,
      roomUrl,
      userDataDir,
      remoteDebuggingPort,
      healStatus: healResult.status,
      healSignals: healResult.signals,
      surfaceStatus: surfaceResult.status,
      surfaceSignals: surfaceResult.signals
    };
  } catch (error) {
    logger.error(
      `roomWindow:launch_failed handle=${roomHandle} userDataDir=${userDataDir} cdpPort=${remoteDebuggingPort} error=${error && typeof error === "object" ? (error.message || String(error)) : String(error)}`
    );
    await closeLaunchBrowserBestEffort(launchResult);
    throw error;
  }
}

function getDefaultRoomUserDataDir(ctx) {
  const { path, process, roomHandle } = ctx;
  const safeHandle = String(roomHandle || "room")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return path.join(process.cwd(), ".room-windows", safeHandle || "room");
}

function readPositiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

async function ensureRoomCommentSurfaceReady(ctx) {
  const { data = {}, deps } = ctx || {};
  const {
    page,
    roomUrl = "",
    navigationTimeoutMs = 120000,
    surfaceWaitMs = 5000
  } = data;
  const { logger } = deps || {};

  if (!page || !roomUrl) {
    return {
      status: "skipped",
      signals: {
        ready: false,
        commentMessages: 0,
        pageUrlMatches: false
      }
    };
  }

  await waitForRoomPageComplete({
    data: { page, timeoutMs: Math.min(navigationTimeoutMs, surfaceWaitMs) },
    deps
  });

  let signals = await probeRoomCommentSurface({
    data: { page, roomUrl },
    deps
  });

  if (signals.ready) {
    return {
      status: "ready",
      signals
    };
  }

  logger.info(
    `roomWindow:comment_surface_missing_refresh_once url=${roomUrl} reason=missing_comments_after_nav_wait`
  );

  try {
    await page.goto(roomUrl, {
      waitUntil: "load",
      timeout: navigationTimeoutMs
    });
  } catch {
    return {
      status: "reload_timeout",
      signals
    };
  }

  await waitForRoomPageComplete({
    data: { page, timeoutMs: Math.min(navigationTimeoutMs, surfaceWaitMs) },
    deps
  });

  signals = await probeRoomCommentSurface({
    data: { page, roomUrl },
    deps
  });

  if (signals.ready) {
    logger.info(`roomWindow:comment_surface_ready_after_refresh url=${roomUrl}`);
    return {
      status: "ready_after_refresh",
      signals
    };
  }

  logger.info(`roomWindow:comment_surface_still_missing url=${roomUrl}`);
  return {
    status: "missing_after_refresh",
    signals
  };
}

async function waitForRoomPageComplete(ctx) {
  const { data = {}, deps } = ctx || {};
  const { page, timeoutMs = 5000 } = data;

  if (!page) {
    return;
  }

  try {
    await page.waitForFunction(() => document.readyState === "complete", {
      timeout: timeoutMs
    });
  } catch {
    // Best effort.
  }

  try {
    await page.waitForNetworkIdle({ idleTime: 1000, timeout: timeoutMs });
  } catch {
    // Best effort.
  }
}

async function probeRoomCommentSurface(ctx) {
  const { data = {} } = ctx || {};
  const { page, roomUrl = "" } = data;

  if (!page || typeof page.evaluate !== "function") {
    return {
      ready: false,
      pageUrlMatches: false,
      commentMessages: 0
    };
  }

  try {
    return await page.evaluate((payload) => {
      const clean = (value) => String(value || "").trim();
      const targetUrl = clean(payload?.roomUrl || "");
      const currentUrl = clean(window.location.href || "");
      const pageUrlMatches = !!targetUrl && currentUrl.startsWith(targetUrl);
      const commentMessages = document.querySelectorAll('div[data-e2e="chat-message"]').length;

      return {
        ready: pageUrlMatches && commentMessages > 0,
        pageUrlMatches,
        commentMessages
      };
    }, { roomUrl });
  } catch {
    return {
      ready: false,
      pageUrlMatches: false,
      commentMessages: 0
    };
  }
}

async function resolveRoomRemoteDebuggingPort(ctx) {
  const { launchOptions = {} } = ctx;
  return await findFreePortFrom(0);
}

async function closeLaunchBrowserBestEffort(launchResult) {
  if (!launchResult || !launchResult.browser || typeof launchResult.browser.close !== "function") {
    return false;
  }

  try {
    await launchResult.browser.close();
  } catch {
    // Best effort.
  }

  return true;
}

async function findFreePortFrom(startPort) {
  let candidatePort = startPort > 0 ? Math.floor(startPort) : 0;

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const port = await tryReservePort(candidatePort);
    if (port > 0) {
      return port;
    }
    candidatePort = candidatePort > 0 ? candidatePort + 1 : 0;
  }

  throw new Error("Unable to reserve a CDP port for room window launch.");
}

async function tryReservePort(port) {
  const server = net.createServer();
  const listenOptions = port > 0
    ? { port, host: "127.0.0.1" }
    : { port: 0, host: "127.0.0.1" };

  return await new Promise((resolve) => {
    server.once("error", () => {
      server.close(() => resolve(0));
    });

    server.listen(listenOptions, () => {
      const address = server.address();
      const reservedPort = typeof address === "object" && address && Number(address.port) > 0
        ? Number(address.port)
        : 0;

      server.close(() => resolve(reservedPort));
    });
  });
}
