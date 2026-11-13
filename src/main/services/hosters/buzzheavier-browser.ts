import { BrowserWindow, session } from "electron";
import { setTimeout as sleep } from "node:timers/promises";
import { logger } from "../logger";

/** Kept between runs so a passed Cloudflare check is remembered. */
const PARTITION = "persist:buzzheavier";
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
    // The button's URL carries a one-time token (?t=...); without it the
    // site just points back at the page.
    const button = document.querySelector("a.download-btn[hx-get], [hx-get*='/download']");
    const target = button?.getAttribute("hx-get")
      || "/" + ${JSON.stringify(encodeURIComponent(id))} + "/download";
    const response = await fetch(target, {
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
  id: string,
  referrer?: string
): Promise<{ url: string | null; status: number }> {
  // Whatever had focus (the main window or Big Picture) gets it back once
  // this window closes; under SteamOS Game Mode focus otherwise stays lost.
  const previouslyFocused = BrowserWindow.getFocusedWindow();
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
    // A hidden window is throttled by Chromium, which can stall Cloudflare's
    // JS check; show it from the start so the check runs and the person can
    // act on it if it needs them.
    window.show();
    window.focus();
    await window
      .loadURL(pageUrl, referrer ? { httpReferrer: referrer } : undefined)
      .catch(() => undefined);

    const started = Date.now();
    let firstLink: LinkResult | null = null;
    let loggedChallenge = false;
    while (!closedByPerson) {
      const challenged = await window.webContents
        .executeJavaScript(READ_CHALLENGE_STATE)
        .catch(() => true);

      if (challenged && !loggedChallenge) {
        loggedChallenge = true;
        logger.log(
          `[Buzzheavier] Waiting for the Cloudflare check (${window.webContents.getURL()})`
        );
      }

      if (!challenged) {
        // The page looks clear; try to read the link. If it still answers 403
        // the check hasn't really cleared, so keep waiting.
        firstLink = (await window.webContents
          .executeJavaScript(readDownloadLink(id))
          .catch(() => null)) as LinkResult | null;
        logger.log(
          `[Buzzheavier] Link request from ${window.webContents.getURL()}: status=${firstLink?.status} link=${Boolean(firstLink?.hxRedirect ?? firstLink?.redirectedTo)}`
        );
        if (firstLink && firstLink.status !== 403) break;
      }

      const waited = Date.now() - started;
      if (waited > CHECK_TIMEOUT_MS) {
        logger.warn("[Buzzheavier] Cloudflare check not passed in time");
        return { url: null, status: 403 };
      }
      await sleep(POLL_MS);
    }

    if (closedByPerson) throw new BuzzheavierCheckCancelledError();
    const result = firstLink;
    if (!result) return { url: null, status: 0 };

    const base = window.webContents.getURL() || pageUrl;
    const target = result.hxRedirect ?? result.redirectedTo;
    return {
      url: target ? new URL(target, base).href : null,
      status: result.status,
    };
  } finally {
    if (!window.isDestroyed()) window.destroy();
    if (previouslyFocused && !previouslyFocused.isDestroyed()) {
      previouslyFocused.focus();
    }
  }
}
