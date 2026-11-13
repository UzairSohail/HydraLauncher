import { BrowserWindow, session } from "electron";
import { setTimeout as sleep } from "node:timers/promises";
import { logger } from "../logger";

/** Kept between runs so a passed Cloudflare check is remembered. */
const PARTITION = "persist:buzzheavier";
/** How long Cloudflare gets to clear on its own before the window is shown. */
const SHOW_AFTER_MS = 5_000;
/** How long the person has to get through the check. */
const CHECK_TIMEOUT_MS = 3 * 60_000;
const POLL_MS = 1_000;

export class BuzzheavierCheckCancelledError extends Error {}

/** True while the page is still Cloudflare's "Just a moment…" check. */
const READ_CHALLENGE_STATE = `(() => {
  const title = document.title || "";
  return /just a moment|attention required|un instant|einen moment/i.test(title)
    || Boolean(document.querySelector("#challenge-form, #challenge-running, .cf-turnstile, #cf-challenge-running"));
})()`;

/**
 * Asks for the file link from inside the page, so the request carries the
 * cookies and browser the Cloudflare check was passed with.
 */
const readDownloadLink = (id: string) => `(async () => {
  const controller = new AbortController();
  try {
    const response = await fetch("/" + ${JSON.stringify(encodeURIComponent(id))} + "/download", {
      headers: { "hx-request": "true", "hx-current-url": location.href },
      signal: controller.signal,
    });
    const hxRedirect = response.headers.get("hx-redirect");
    const result = {
      status: response.status,
      hxRedirect,
      redirectedTo: response.redirected ? response.url : null,
    };
    controller.abort();
    return result;
  } catch (error) {
    return { status: 0, hxRedirect: null, redirectedTo: null };
  }
})()`;

interface LinkResult {
  status: number;
  hxRedirect: string | null;
  redirectedTo: string | null;
}

/**
 * Opens a Buzzheavier file page in Nacho's own browser. If Cloudflare's check
 * doesn't clear by itself within a few seconds, the window is shown so the
 * person can get through it like in any browser; nothing is solved for them.
 * Returns the file link, or null if the page gave none.
 */
export async function resolveBuzzheavierInBrowser(
  pageUrl: string,
  id: string
): Promise<{ url: string | null; status: number }> {
  const browserSession = session.fromPartition(PARTITION);
  browserSession.setPermissionRequestHandler((_c, _p, callback) =>
    callback(false)
  );
  browserSession.on("will-download", (event) => event.preventDefault());

  const window = new BrowserWindow({
    show: false,
    width: 960,
    height: 720,
    title: "Buzzheavier – confirm you're human to continue the download",
    autoHideMenuBar: true,
    webPreferences: {
      session: browserSession,
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  window.webContents.setAudioMuted(true);
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  let closedByPerson = false;
  window.on("closed", () => {
    closedByPerson = true;
  });

  try {
    logger.log(`[Buzzheavier] Opening ${pageUrl} in the app browser`);
    await window.loadURL(pageUrl).catch(() => undefined);

    const started = Date.now();
    while (!closedByPerson) {
      const challenged = await window.webContents
        .executeJavaScript(READ_CHALLENGE_STATE)
        .catch(() => true);
      if (!challenged) break;

      const waited = Date.now() - started;
      if (waited > CHECK_TIMEOUT_MS) {
        logger.warn("[Buzzheavier] Cloudflare check not passed in time");
        return { url: null, status: 403 };
      }
      if (waited > SHOW_AFTER_MS && !window.isVisible()) {
        logger.log("[Buzzheavier] Showing the Cloudflare check to the person");
        window.show();
        window.focus();
      }
      await sleep(POLL_MS);
    }

    if (closedByPerson) throw new BuzzheavierCheckCancelledError();
    const result = (await window.webContents
      .executeJavaScript(readDownloadLink(id))
      .catch(() => null)) as LinkResult | null;
    if (!result) return { url: null, status: 0 };

    const base = window.webContents.getURL() || pageUrl;
    const target = result.hxRedirect ?? result.redirectedTo;
    return {
      url: target ? new URL(target, base).href : null,
      status: result.status,
    };
  } finally {
    if (!window.isDestroyed()) window.destroy();
  }
}
