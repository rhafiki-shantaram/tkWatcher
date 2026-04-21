/**
 * Probe whether a room window is foregrounded and visible.
 * @param {{ data?: object, deps: object }} ctx
 * @returns {Promise<{ focused: boolean, visibilityState: string, hidden: boolean }>}
 */
export async function probeRoomWindowFocus(ctx) {
  const { data = {} } = ctx;
  const { page } = data;

  if (!page || typeof page.evaluate !== "function") {
    return {
      focused: false,
      visibilityState: "unknown",
      hidden: true
    };
  }

  try {
    return await page.evaluate(() => ({
      focused: !!document.hasFocus(),
      visibilityState: String(document.visibilityState || "unknown"),
      hidden: !!document.hidden
    }));
  } catch {
    return {
      focused: false,
      visibilityState: "unknown",
      hidden: true
    };
  }
}
