/**
 * Create a minimal tracked-tab manager for a shared Puppeteer browser session.
 * No OS focus assumptions. No scheduler. No persistence.
 * @param {{ data?: object, deps: object }} ctx
 * @returns {{
 *   browser: any,
 *   registerTab: Function,
 *   getTab: Function,
 *   listTabs: Function,
 *   openTab: Function,
 *   closeTab: Function
 * }}
 */
export function createTabSessionManager(ctx) {
  const { data = {}, deps } = ctx;
  const { browser } = data;
  const { logger } = deps;

  if (!browser) {
    throw new Error("Missing browser for tab session manager.");
  }

  const tabs = new Map();

  function registerTab(name, page, meta = {}) {
    if (!name) {
      throw new Error("Missing tab name.");
    }
    if (!page) {
      throw new Error(`Missing page for tab ${name}.`);
    }

    const tab = {
      name: String(name),
      page,
      meta: { ...meta },
      createdAtMs: Date.now()
    };

    tabs.set(tab.name, tab);
    return tab;
  }

  function getTab(name) {
    return tabs.get(String(name)) || null;
  }

  function listTabs() {
    return Array.from(tabs.values()).map((tab) => ({
      name: tab.name,
      meta: { ...tab.meta },
      createdAtMs: tab.createdAtMs,
      isClosed: !!tab.page?.isClosed?.()
    }));
  }

  async function openTab(name, openOptions = {}) {
    const {
      url = "",
      waitUntil = "load",
      timeoutMs = 120000,
      meta = {}
    } = openOptions;

    const page = await browser.newPage();
    registerTab(name, page, meta);

    if (url) {
      await page.goto(url, {
        waitUntil,
        timeout: timeoutMs
      });
    }

    logger.info(`tabSession:opened name=${name}${url ? ` url=${url}` : ""}`);
    return page;
  }

  async function closeTab(name) {
    const tab = getTab(name);
    if (!tab) {
      return false;
    }

    tabs.delete(String(name));

    if (tab.page && typeof tab.page.close === "function" && !tab.page.isClosed()) {
      await tab.page.close();
    }

    logger.info(`tabSession:closed name=${name}`);
    return true;
  }

  return {
    browser,
    registerTab,
    getTab,
    listTabs,
    openTab,
    closeTab
  };
}
