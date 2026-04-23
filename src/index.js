import {
  createRuntimeLaunchOptions,
  readRuntimeEnv
} from "./config/runtimeEnv.js";
import { createDeps } from "./deps/index.js";
import {
  launchBrowser,
  runWatchCycle
} from "./modules/browser/index.js";
import {
  runCommentLiveCaptureLoop
} from "./modules/comments/index.js";

function waitForExit(deps) {
  const { process } = deps;

  return new Promise((resolve) => {
    const cleanup = () => {
      process.off("SIGINT", onExit);
      process.off("SIGTERM", onExit);
    };
    const onExit = () => {
      cleanup();
      resolve();
    };

    process.on("SIGINT", onExit);
    process.on("SIGTERM", onExit);
  });
}

async function main(ctx) {
  const { deps } = ctx;
  const { dotenv, logger, process } = deps;

  dotenv.config();

  const runtimeEnv = readRuntimeEnv(process.env);
  const launchOptions = createRuntimeLaunchOptions(runtimeEnv);
  const {
    tiktokUrl,
    targetHandles,
    cookiesPath,
    keepAlive,
    commentCapture,
    navigationTimeoutMs,
    loginWaitMs,
    loginPollMs,
    commentCaptureStorageRoot
  } = runtimeEnv;

  if (!tiktokUrl) {
    throw new Error("Missing TIKTOK_URL.");
  }
  if (!targetHandles.length) {
    throw new Error("Missing TARGET_HANDLES.");
  }

  logger.info(
    `Runtime env contract active: TIKTOK_URL, TARGET_HANDLES, COOKIES_PATH, KEEP_ALIVE, COMMENT_CAPTURE, COMMENT_CAPTURE_STORAGE_ROOT, CDP_REMOTE_DEBUGGING_PORT, NAVIGATION_TIMEOUT_MS, LOGIN_WAIT_MS, LOGIN_POLL_MS, COMMENT_INGEST_ENABLED`
  );
  logger.info(
    `Runtime env values: targetHandles=${targetHandles.join(",")} cookiesPath=${cookiesPath}`
  );

  const { browser, page } = await launchBrowser({
    data: {
      launchOptions
    },
    deps
  });
  try {
    logger.info("CDP harness ready.");
    const runResult = await runWatchCycle({
      data: {
        page,
        targetUrl: tiktokUrl,
        cookiesPath,
        navigationTimeoutMs,
        loginWaitMs,
        loginPollMs
      },
      deps
    });
    logger.info(`Navigated to ${tiktokUrl}`);
    logger.info(`Watch cycle heal status: ${runResult.healStatus}`);
    logger.info(`Target status: ${runResult.targetStatus.status}`);
    if (runResult.title) {
      logger.info(`Page title: ${runResult.title}`);
    }
    if (commentCapture) {
      logger.info("Comment capture enabled. Starting room lifecycle loop.");
      await runCommentLiveCaptureLoop({
        data: {
          watcherPage: page,
          cookiesPath,
          targetHandles,
          launchOptions,
          notLiveStreakThreshold: 5,
          commentCaptureStorageRoot
        },
        deps
      });
    }
    if (keepAlive) {
      logger.info("keepAlive enabled. Waiting for Ctrl+C.");
      await waitForExit(deps);
    } else {
      logger.info("keepAlive disabled. Closing browser after navigation.");
    }
  } finally {
    await browser.close();
  }
}

const { deps } = createDeps({ data: { logger: console } });

main({ deps }).catch((error) => {
  if (error && typeof error === "object") {
    const stage = error.stage ? ` stage=${error.stage}` : "";
    const code = error.code ? ` code=${error.code}` : "";
    deps.logger.error(`${error.message || String(error)}${stage}${code}`);
  } else {
    deps.logger.error(error);
  }
  deps.process.exit(1);
});
