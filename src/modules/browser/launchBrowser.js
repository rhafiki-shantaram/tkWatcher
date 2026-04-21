/**
 * Launch a visible browser window for Puppeteer/CDP work.
 * @param {{ data?: object, deps: object }} ctx
 * @returns {Promise<{ browser: any, page: any }>}
 */
export async function launchBrowser(ctx) {
  const { data = {}, deps } = ctx;
  const { launchOptions = {} } = data;
  const { fs, puppeteerExtra, stealthPlugin, logger, process } = deps;

  puppeteerExtra.use(stealthPlugin());

  const defaultArgs = [
    "--start-maximized",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    "--disable-features=CalculateNativeWinOcclusion",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-infobars"
  ];
  const userArgs = Array.isArray(launchOptions.args) ? launchOptions.args : [];
  const remoteDebuggingPort = readPositiveInt(launchOptions.remoteDebuggingPort);
  const remoteDebuggingArgs = remoteDebuggingPort
    ? [`--remote-debugging-port=${remoteDebuggingPort}`]
    : [];
  const args = Array.from(new Set([...defaultArgs, ...remoteDebuggingArgs, ...userArgs]));
  const executablePath = launchOptions.executablePath || resolveBrowserExecutablePath({
    data: { fs, process },
    deps
  });

  if (!executablePath) {
    throw new Error(
      "No Chrome/Edge executable found. Install Chrome, or set launchOptions.executablePath."
    );
  }

  const browser = await puppeteerExtra.launch({
    headless: false,
    defaultViewport: null,
    ...launchOptions,
    executablePath,
    args
  });

  const pages = await browser.pages();
  let page = pages[0] || null;
  if (!page) {
    page = await browser.newPage();
  }
  for (const extraPage of pages.slice(1)) {
    await extraPage.close();
  }

  const wsEndpoint = browser.wsEndpoint();
  logger.info(
    remoteDebuggingPort
      ? `Browser launched. wsEndpoint=${wsEndpoint} remoteDebuggingPort=${remoteDebuggingPort}`
      : `Browser launched. wsEndpoint=${wsEndpoint}`
  );
  return { browser, page, wsEndpoint };
}

function readPositiveInt(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function resolveBrowserExecutablePath(ctx) {
  const { data = {} } = ctx;
  const { fs, process } = data;

  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    process.env.PROGRAMFILES
      ? `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`
      : "",
    process.env["PROGRAMFILES(X86)"]
      ? `${process.env["PROGRAMFILES(X86)"]}\\Google\\Chrome\\Application\\chrome.exe`
      : "",
    process.env.PROGRAMFILES
      ? `${process.env.PROGRAMFILES}\\Microsoft\\Edge\\Application\\msedge.exe`
      : "",
    process.env["PROGRAMFILES(X86)"]
      ? `${process.env["PROGRAMFILES(X86)"]}\\Microsoft\\Edge\\Application\\msedge.exe`
      : "",
    process.env.LOCALAPPDATA
      ? `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`
      : "",
    process.env.LOCALAPPDATA
      ? `${process.env.LOCALAPPDATA}\\Microsoft\\Edge\\Application\\msedge.exe`
      : ""
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return "";
}
