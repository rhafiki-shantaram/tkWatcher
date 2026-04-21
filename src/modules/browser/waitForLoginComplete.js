import { createStageError } from "./stageError.js";

/**
 * Wait for manual login completion or session recovery.
 * @param {{ data?: object, deps: object }} ctx
 * @returns {Promise<{ status: string, cookieCount: number }>}
 */
export async function waitForLoginComplete(ctx) {
  const { data = {}, deps } = ctx;
  const {
    page,
    waitMs = 120000,
    pollMs = 1500,
    urlBlocklist = ["login"]
  } = data;
  const { logger, Date: DateCtor, process, readline, setTimeout } = deps;

  if (!page) {
    throw new Error("Missing page for login wait.");
  }

  await waitForPageReady({
    data: { page, timeoutMs: Math.min(waitMs, 15000) },
    deps
  });

  const startMs = DateCtor.now();
  const initialUrl = String(page.url() || "");
  const initialCookies = await page.cookies();
  const initialCount = initialCookies.length;
  const initialProbe = await probeLoginState({
    data: { page, urlBlocklist }
  });

  logger.info(
    `Login watch start. cookies=${initialCount} url=${initialUrl} loggedIn=${initialProbe.loggedIn ? 1 : 0}`
  );

  if (initialProbe.loggedIn) {
    return { status: "already_logged_in", cookieCount: initialCount };
  }

  while (DateCtor.now() - startMs < waitMs) {
    const url = String(page.url() || "");
    const cookies = await page.cookies();
    const cookieCount = cookies.length;
    const probe = await probeLoginState({
      data: { page, urlBlocklist }
    });

    if (probe.loggedIn) {
      logger.info(`Login complete. cookies=${cookieCount} url=${url}`);
      return { status: "login_complete", cookieCount };
    }

    if (process.stdin.isTTY) {
      const confirmed = await waitForEnterOrTimeout({
        data: { prompt: "Login in browser, then press Enter...", ms: pollMs },
        deps
      });
      if (confirmed.pressed) {
        const finalCookies = await page.cookies();
        logger.info(`Manual login confirmed. cookies=${finalCookies.length}`);
        return { status: "manual_confirmed", cookieCount: finalCookies.length };
      }
    } else {
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }

  const finalCookies = await page.cookies();
  logger.info(`Login wait timeout. cookies=${finalCookies.length}`);
  return { status: "timeout", cookieCount: finalCookies.length };
}

async function waitForPageReady(ctx) {
  const { data = {}, deps } = ctx;
  const { page, timeoutMs = 15000 } = data;
  const { logger } = deps;

  if (!page) {
    return;
  }

  try {
    await page.waitForFunction(() => document.readyState === "complete", {
      timeout: timeoutMs
    });
  } catch {
    throw createStageError(
      "login_page_load_timeout",
      "Login page did not reach complete state in time.",
      "E_LOGIN_PAGE_LOAD_TIMEOUT"
    );
  }

  try {
    await page.waitForNetworkIdle({ idleTime: 1000, timeout: timeoutMs });
  } catch {
    // Best effort.
  }

  logger.info("Page ready for login probe.");
}

async function probeLoginState(ctx) {
  const { data = {} } = ctx;
  const { page, urlBlocklist = [] } = data;
  const url = String(page.url() || "");
  const lowerUrl = url.toLowerCase();
  const loginUrl = urlBlocklist.some((token) =>
    lowerUrl.includes(String(token || "").toLowerCase())
  );

  const result = await page.evaluate(() => {
    const loginLabels = Array.from(
      document.querySelectorAll("div.TUXButton-label")
    ).map((el) => String(el.innerText || el.textContent || "").trim());
    const hasLoginLabel = loginLabels.some((text) => text === "Log in");

    const hasPasswordField = !!document.querySelector("input[type='password']");
    const hasUsernameField = !!document.querySelector(
      "input[type='email'], input[name*='user' i], input[name*='email' i], input[placeholder*='email' i]"
    );

    return {
      hasLoginLabel,
      hasPasswordField,
      hasUsernameField
    };
  });

  const loggedIn = !loginUrl && !result.hasLoginLabel && !result.hasPasswordField;
  return {
    loggedIn,
    loginUrl,
    hasLoginLabel: result.hasLoginLabel,
    hasPasswordField: result.hasPasswordField,
    hasUsernameField: result.hasUsernameField
  };
}

async function waitForEnterOrTimeout(ctx) {
  const { data = {}, deps } = ctx;
  const { prompt = "Press Enter...", ms = 1500 } = data;
  const { process, readline, setTimeout } = deps;

  if (!process.stdin.isTTY) {
    await new Promise((resolve) => setTimeout(resolve, ms));
    return { pressed: false };
  }

  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      rl.close();
      resolve({ pressed: false });
    }, ms);

    rl.question(prompt, () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      rl.close();
      resolve({ pressed: true });
    });
  });
}
