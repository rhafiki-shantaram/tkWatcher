function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function normalizePath(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "/_functions/commentIngestTest";
  }
  return text.startsWith("/") ? text : `/${text}`;
}

function createIngestUrl(baseUrl, ingestPath) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const normalizedPath = normalizePath(ingestPath);
  if (!normalizedBaseUrl) {
    return "";
  }
  return `${normalizedBaseUrl}${normalizedPath}`;
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isRetryableStatus(status) {
  const code = Math.max(0, Number(status) || 0);
  return code === 408 || code === 425 || code === 429 || code >= 500;
}

function isAbortError(error) {
  return error && typeof error === "object" && String(error.name || "") === "AbortError";
}

async function sleep(ms, deps) {
  await new Promise((resolve) => deps.setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

/**
 * Create a comment ingest sender.
 * @param {{ data?: object, deps: object }} ctx
 * @returns {{ sendCommentIngest: Function, resolveCommentIngestUrl: Function }}
 */
export function createCommentIngestSender(ctx) {
  const { data = {}, deps } = ctx || {};
  const {
    testBaseUrl = "",
    prodBaseUrl = "",
    ingestPath = "/_functions/commentIngestTest",
    dryRun = false,
    timeoutMs = 15000,
    retryAttempts = 2,
    retryDelayMs = 250
  } = data;
  const { logger } = deps;
  const fetchImpl = deps.fetch || globalThis.fetch;

  if (typeof fetchImpl !== "function") {
    throw new Error("Missing fetch implementation for comment ingest sender.");
  }

  function resolveCommentIngestUrl(target = "test") {
    const baseUrl = target === "prod" ? prodBaseUrl : testBaseUrl;
    const urlText = createIngestUrl(baseUrl, ingestPath);
    if (!urlText) {
      return "";
    }
    return urlText;
  }

  async function sendCommentIngest(payload, options = {}) {
    const target = String(options.target || "test").trim() === "prod" ? "prod" : "test";
    const url = resolveCommentIngestUrl(target);
    if (!url) {
      throw new Error(`Missing comment ingest ${target} base URL.`);
    }

    if (dryRun) {
      logger.info(
        `commentIngest:dry_run target=${target} url=${url} commentKey=${String(payload?.commentKey || "").trim() || "(unknown)"}`
      );
      return {
        ok: true,
        dryRun: true,
        target,
        url,
        status: 0,
        body: payload || null
      };
    }

    const maxAttempts = Math.max(1, Math.floor(Number(retryAttempts) || 1));
    const baseDelayMs = Math.max(0, Number(retryDelayMs) || 0);
    const commentKey = String(payload?.commentKey || "").trim() || "(unknown)";
    const requestMethod = "POST";
    let lastResult = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const abortController = new AbortController();
      const timer = deps.setTimeout(() => abortController.abort(), Math.max(0, Number(timeoutMs) || 0));
      const requestUrl = url;

      logger.info(
        `commentIngest:send_start target=${target} attempt=${attempt}/${maxAttempts} method=${requestMethod} url=${requestUrl} commentKey=${commentKey}`
      );

      try {
        const requestOptions = {
          method: requestMethod,
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json"
          },
          signal: abortController.signal,
          body: JSON.stringify(payload || {})
        };

        const response = await fetchImpl(requestUrl, requestOptions);
        const responseText = await response.text();
        const responseBody = responseText ? safeJsonParse(responseText) || responseText : null;
        const result = {
          ok: response.ok,
          dryRun: false,
          target,
          url: requestUrl,
          status: response.status,
          body: responseBody
        };

        if (!response.ok && attempt < maxAttempts && isRetryableStatus(response.status)) {
          logger.info(
            `commentIngest:send_retry target=${target} attempt=${attempt}/${maxAttempts} method=${requestMethod} url=${requestUrl} status=${response.status}`
          );
          lastResult = result;
          await sleep(baseDelayMs * attempt, deps);
          continue;
        }

        if (!response.ok) {
          logger.error(
            `commentIngest:send_failed target=${target} method=${requestMethod} url=${requestUrl} status=${response.status} body=${typeof responseBody === "string" ? responseBody : JSON.stringify(responseBody)}`
          );
        } else {
          logger.info(
            `commentIngest:send_done target=${target} method=${requestMethod} url=${requestUrl} status=${response.status}`
          );
        }

        return result;
      } catch (error) {
        const retryable = attempt < maxAttempts && !isAbortError(error);
        if (retryable) {
          logger.info(
            `commentIngest:send_retry target=${target} attempt=${attempt}/${maxAttempts} method=${requestMethod} url=${requestUrl} error=${error && typeof error === "object" ? (error.message || String(error)) : String(error)}`
          );
          lastResult = {
            ok: false,
            dryRun: false,
            target,
            url: requestUrl,
            status: 0,
            error
          };
          await sleep(baseDelayMs * attempt, deps);
          continue;
        }

        logger.error(
          `commentIngest:send_error target=${target} method=${requestMethod} url=${requestUrl} error=${error && typeof error === "object" ? (error.message || String(error)) : String(error)}`
        );
        return {
          ok: false,
          dryRun: false,
          target,
          url: requestUrl,
          status: 0,
          error
        };
      } finally {
        deps.clearTimeout(timer);
      }
    }

    return lastResult || {
      ok: false,
      dryRun: false,
      target,
      url,
      status: 0
    };
  }

  return {
    sendCommentIngest,
    resolveCommentIngestUrl
  };
}
