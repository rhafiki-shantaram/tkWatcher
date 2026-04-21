/**
 * Load cookies from disk and apply them to current page.
 * @param {{ data?: object, deps: object }} ctx
 * @returns {Promise<{ loaded: boolean }>}
 */
export async function loadCookies(ctx) {
  const { data = {}, deps } = ctx;
  const { cookiesPath = "", page } = data;
  const { fs, logger } = deps;

  if (!cookiesPath || !page) {
    return { loaded: false };
  }

  if (!fs.existsSync(cookiesPath)) {
    logger.info(`No cookies file at ${cookiesPath}.`);
    return { loaded: false };
  }

  let raw = "";
  try {
    raw = await fs.promises.readFile(cookiesPath, "utf8");
  } catch (error) {
    throw new Error(`Failed to read cookies file at ${cookiesPath}: ${error.message || error}`);
  }

  const text = String(raw || "").replace(/^\uFEFF/, "").trim();
  if (!text) {
    logger.info(`Cookies file empty at ${cookiesPath}.`);
    return { loaded: false };
  }

  let cookies = null;
  try {
    cookies = JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid cookies JSON at ${cookiesPath}: ${error.message || error}`);
  }

  if (!Array.isArray(cookies)) {
    throw new Error(`Invalid cookies JSON at ${cookiesPath}: expected array.`);
  }

  const sanitized = cookies
    .map((cookie) => sanitizeCookie(cookie))
    .filter((cookie) => cookie.name && cookie.value);

  if (sanitized.length === 0) {
    logger.info(`No usable cookies in ${cookiesPath}.`);
    return { loaded: false };
  }

  await page.setCookie(...sanitized);
  logger.info(`Loaded ${sanitized.length} cookies from ${cookiesPath}.`);
  return { loaded: true, count: sanitized.length };
}

function sanitizeCookie(cookie) {
  const allowedKeys = new Set([
    "name",
    "value",
    "domain",
    "path",
    "expires",
    "httpOnly",
    "secure",
    "sameSite",
    "url"
  ]);
  const cleaned = {};
  for (const [key, value] of Object.entries(cookie || {})) {
    if (allowedKeys.has(key)) {
      cleaned[key] = value;
    }
  }
  return cleaned;
}
