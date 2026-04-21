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
  const remoteDebuggingPort = await resolveRoomRemoteDebuggingPort({
    launchOptions,
    process
  });
  const launchResult = await launchBrowser({
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
      timeout: readPositiveInt(launchOptions.navigationTimeoutMs, 120000)
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
      timeout: readPositiveInt(launchOptions.navigationTimeoutMs, 120000)
    });
  }

  const healResult = await selfHealTargetPage({
    data: {
      page: launchResult.page,
      targetUrl: roomUrl,
      navigationTimeoutMs: readPositiveInt(launchOptions.navigationTimeoutMs, 120000)
    },
    deps
  });

  logger.info(
    `roomWindow:launched handle=${roomHandle} cdpPort=${remoteDebuggingPort} userDataDir=${userDataDir}${cookiesPath ? ` cookiesPath=${cookiesPath}` : ""}${roomUrl ? ` url=${roomUrl}` : ""} heal=${healResult.status}`
  );

  return {
    ...launchResult,
    roomHandle,
    roomUrl,
    userDataDir,
    remoteDebuggingPort,
    healStatus: healResult.status,
    healSignals: healResult.signals
  };
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

async function resolveRoomRemoteDebuggingPort(ctx) {
  const { launchOptions = {} } = ctx;
  return await findFreePortFrom(0);
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
