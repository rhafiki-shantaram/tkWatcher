/**
 * Bring a room page to the foreground for a brief capture pulse.
 * @param {{ data?: object }} ctx
 * @returns {Promise<{ focused: boolean }>}
 */
export async function focusRoomWindow(ctx) {
  const { data = {} } = ctx;
  const { page } = data;

  if (!page || typeof page.bringToFront !== "function") {
    return { focused: false };
  }

  try {
    await page.bringToFront();
    return { focused: true };
  } catch {
    return { focused: false };
  }
}
