/**
 * Resolve commenter profile data without assuming foreground tab focus.
 * DOM first. Network fallback second. Popover reveal only as an explicit fallback.
 * @param {{ data?: object, deps: object }} ctx
 * @returns {Promise<{ profileName: string, profileHref: string, source: string, found: boolean, attempts: string[] }>}
 */
export async function resolveCommentProfileBackground(ctx) {
  const { data = {}, deps } = ctx;
  const {
    page,
    waitMs = 4000,
    resolveProfileFromNetwork = null,
    revealPopover = null
  } = data;

  if (!page) {
    throw new Error("Missing page for background profile resolution.");
  }

  const attempts = [];

  const initialPopover = await readPopoverProfile({
    data: { page, waitMs },
    deps
  });
  attempts.push("dom_initial");
  if (initialPopover.profileName || initialPopover.profileHref) {
    return finalizeResult(initialPopover, "dom", attempts);
  }

  if (typeof resolveProfileFromNetwork === "function") {
    attempts.push("network_initial");
    const networkProfile = await readNetworkProfile({
      data: { resolveProfileFromNetwork },
      deps
    });
    if (networkProfile.profileName || networkProfile.profileHref) {
      return finalizeResult(networkProfile, "network", attempts);
    }
  }

  if (typeof revealPopover === "function") {
    attempts.push("popover_reveal");
    await revealPopover();

    const revealedPopover = await readPopoverProfile({
      data: { page, waitMs },
      deps
    });
    attempts.push("dom_after_reveal");
    if (revealedPopover.profileName || revealedPopover.profileHref) {
      return finalizeResult(revealedPopover, "dom_after_reveal", attempts);
    }
  }

  if (typeof resolveProfileFromNetwork === "function") {
    attempts.push("network_after_reveal");
    const networkProfile = await readNetworkProfile({
      data: { resolveProfileFromNetwork },
      deps
    });
    if (networkProfile.profileName || networkProfile.profileHref) {
      return finalizeResult(networkProfile, "network_after_reveal", attempts);
    }
  }

  return {
    profileName: "",
    profileHref: "",
    source: "missing",
    found: false,
    attempts
  };
}

async function readPopoverProfile(ctx) {
  const { data = {}, deps } = ctx;
  const { page, waitMs = 4000 } = data;

  try {
    await page.waitForFunction(
      () => {
        const popovers = Array.from(document.querySelectorAll("div.absolute.h-auto"));
        return popovers.some((popover) => {
          const name = popover.querySelector("div.P2-Bold");
          const profileLink = popover.querySelector('a[href^="/@"]');
          return !!(name || profileLink);
        });
      },
      { timeout: waitMs }
    );
  } catch (error) {
    return {
      profileName: "",
      profileHref: "",
      error: String(error && error.message ? error.message : error || "")
    };
  }

  const result = await page.evaluate(() => {
    const clean = (value) =>
      String(value || "")
        .replace(/\s+/g, " ")
        .trim();

    const popoverCandidates = Array.from(document.querySelectorAll("div.absolute.h-auto"));
    for (const popover of popoverCandidates) {
      const profileNameEl = popover.querySelector("div.P2-Bold");
      const profileNameText = clean(profileNameEl?.textContent || "");
      const profileLink = popover.querySelector('a[href^="/@"]');
      const hrefRaw = clean(profileLink?.getAttribute("href") || "");
      const href = hrefRaw ? new URL(hrefRaw, window.location.origin).toString() : "";
      if (profileNameText) {
        return {
          profileName: profileNameText,
          profileHref: href
        };
      }
      if (href.includes("/@")) {
        return {
          profileName: clean(href.split("/@")[1]?.split("/")[0] || ""),
          profileHref: href
        };
      }
    }

    return {
      profileName: "",
      profileHref: "",
      error: "popover_empty"
    };
  });

  return result;
}

async function readNetworkProfile(ctx) {
  const { data = {} } = ctx;
  const { resolveProfileFromNetwork } = data;

  try {
    const profile = await resolveProfileFromNetwork({ waitMs: 1200 });
    if (!profile || typeof profile !== "object") {
      return {
        profileName: "",
        profileHref: ""
      };
    }

    return {
      profileName: String(profile.profileName || "").trim(),
      profileHref: String(profile.profileHref || "").trim()
    };
  } catch (error) {
    return {
      profileName: "",
      profileHref: "",
      error: String(error && error.message ? error.message : error || "")
    };
  }
}

function finalizeResult(profile, source, attempts) {
  return {
    profileName: String(profile.profileName || "").trim(),
    profileHref: String(profile.profileHref || "").trim(),
    source,
    found: !!(String(profile.profileName || "").trim() || String(profile.profileHref || "").trim()),
    attempts
  };
}
