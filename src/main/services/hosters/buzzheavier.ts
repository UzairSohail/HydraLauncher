import { DownloadError, isBuzzheavierUri } from "@shared";
import { logger } from "../logger";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0";

/**
 * Buzzheavier's download button is an htmx request: asking for
 * `/<id>/download` answers with an `hx-redirect` header that points at the file.
 */
export class BuzzheavierApi {
  public static canHandle(uri: string): boolean {
    return isBuzzheavierUri(uri);
  }

  public static async getDownloadUrl(uri: string): Promise<string> {
    const url = new URL(uri);
    const id = url.pathname.split("/").filter(Boolean)[0];
    if (!this.canHandle(uri) || !id) {
      throw new Error(`Invalid Buzzheavier URL: ${uri}`);
    }

    // Short domains (bzzhr.co, bzzhr.to) share Buzzheavier's file ids; if
    // one doesn't answer with a link, ask the main site.
    const origins = [...new Set([url.origin, "https://buzzheavier.com"])];
    let notFound = false;
    let challengedOrigin: string | null = null;
    for (const origin of origins) {
      const pageUrl = `${origin}/${id}`;
      const response = await fetch(`${pageUrl}/download`, {
        redirect: "manual",
        headers: {
          "User-Agent": USER_AGENT,
          Referer: pageUrl,
          "hx-current-url": pageUrl,
          "hx-request": "true",
        },
      }).catch((error: unknown) => {
        logger.warn(`[Buzzheavier] ${origin} unreachable`, error);
        return null;
      });
      if (!response) continue;
      await response.body?.cancel();

      if (response.status === 404) {
        notFound = true;
        continue;
      }

      if (response.status === 403) {
        // Cloudflare's "Just a moment…" check; plain requests can't pass it.
        challengedOrigin ??= origin;
        continue;
      }

      const hxRedirect = response.headers.get("hx-redirect");
      const location = response.headers.get("location");
      if (hxRedirect) return new URL(hxRedirect, origin).href;
      if (location) {
        const next = new URL(location, origin);
        // A short domain forwarding to the main site's page for this file is
        // not the file itself; ask the main site directly instead.
        const isPageRedirect =
          isBuzzheavierUri(next.href) && next.pathname.startsWith(`/${id}`);
        if (!isPageRedirect) return next.href;
        continue;
      }

      logger.warn(
        `[Buzzheavier] No download link for ${id} from ${origin} (status=${response.status})`
      );
    }

    if (challengedOrigin && !notFound) {
      const link = await this.resolveInBrowser(challengedOrigin, id);
      if (link) return link;
    }

    throw new Error(
      notFound
        ? DownloadError.HosterUnlockFileNotFound
        : DownloadError.HosterUnlockUnavailable
    );
  }

  /**
   * Opens the page in the app's browser, showing it if Cloudflare wants the
   * person to confirm they're human, then asks for the file link from there.
   */
  private static async resolveInBrowser(
    origin: string,
    id: string
  ): Promise<string | null> {
    const { resolveBuzzheavierInBrowser, BuzzheavierCheckCancelledError } =
      await import("./buzzheavier-browser");
    try {
      const { url, status } = await resolveBuzzheavierInBrowser(
        `${origin}/${id}`,
        id
      );
      if (status === 404)
        throw new Error(DownloadError.HosterUnlockFileNotFound);
      if (!url) {
        logger.warn(
          `[Buzzheavier] No download link for ${id} in the app browser (status=${status})`
        );
        return null;
      }
      const next = new URL(url);
      if (isBuzzheavierUri(next.href) && next.pathname.startsWith(`/${id}`)) {
        return null;
      }
      return next.href;
    } catch (error) {
      if (error instanceof BuzzheavierCheckCancelledError) {
        logger.log(
          "[Buzzheavier] Cloudflare check window closed by the person"
        );
        return null;
      }
      throw error;
    }
  }
}
