import { DownloadError } from "@shared";
import { logger } from "../logger";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0";

export const BUZZHEAVIER_HOSTS = ["buzzheavier.com", "bzzhr.co"];

/**
 * Buzzheavier's download button is an htmx request: asking for
 * `/<id>/download` answers with an `hx-redirect` header that points at the file.
 */
export class BuzzheavierApi {
  public static canHandle(uri: string): boolean {
    try {
      const host = new URL(uri).hostname.replace(/^www\./, "");
      return BUZZHEAVIER_HOSTS.includes(host);
    } catch {
      return false;
    }
  }

  public static async getDownloadUrl(uri: string): Promise<string> {
    const url = new URL(uri);
    const id = url.pathname.split("/").filter(Boolean)[0];
    if (!this.canHandle(uri) || !id) {
      throw new Error(`Invalid Buzzheavier URL: ${uri}`);
    }

    const pageUrl = `${url.origin}/${id}`;
    const response = await fetch(`${pageUrl}/download`, {
      redirect: "manual",
      headers: {
        "User-Agent": USER_AGENT,
        Referer: pageUrl,
        "hx-current-url": pageUrl,
        "hx-request": "true",
      },
    });
    await response.body?.cancel();

    if (response.status === 404) {
      throw new Error(DownloadError.HosterUnlockFileNotFound);
    }

    const target =
      response.headers.get("hx-redirect") ?? response.headers.get("location");
    if (!target) {
      logger.warn(
        `[Buzzheavier] No download link for ${id} (status=${response.status})`
      );
      throw new Error(DownloadError.HosterUnlockUnavailable);
    }

    return new URL(target, url.origin).href;
  }
}
