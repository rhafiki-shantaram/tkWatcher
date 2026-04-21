/**
 * Save current page cookies to disk.
 * @param {{ data?: object, deps: object }} ctx
 * @returns {Promise<{ saved: boolean }>}
 */
export async function saveCookies(ctx) {
  const { data = {}, deps } = ctx;
  const { cookiesPath = "", page } = data;
  const { fs, path, logger } = deps;

  if (!cookiesPath || !page) {
    return { saved: false };
  }

  let cookies = [];
  try {
    cookies = await page.cookies();
  } catch (error) {
    throw new Error(`Failed to read browser cookies: ${error.message || error}`);
  }

  const sanitized = cookies.map((cookie) => sanitizeCookie(cookie));
  const dir = path.dirname(cookiesPath);
  await fs.promises.mkdir(dir, { recursive: true });

  const tempPath = `${cookiesPath}.tmp`;
  const payload = `${JSON.stringify(sanitized, null, 2)}\n`;

  try {
    await fs.promises.writeFile(tempPath, payload, "utf8");
    await fs.promises.rename(tempPath, cookiesPath);
  } catch (error) {
    throw new Error(`Failed to save cookies to ${cookiesPath}: ${error.message || error}`);
  }

  logger.info(`Saved ${sanitized.length} cookies to ${cookiesPath}.`);
  return { saved: true, count: sanitized.length };
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
