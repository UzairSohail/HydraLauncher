import { DownloadError, isMegaDbUri } from "@shared";
import { logger } from "../logger";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

const ORIGIN = "https://megadb.net";
const DEFAULT_WAIT_SECONDS = 10;
const MAX_WAIT_SECONDS = 60;
const ATTEMPTS = 3;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * MegaDB (YetiShare-style host):
 * 1. GET the file page. Hotlink protection rejects foreign referers, so the
 *    request is sent with MegaDB itself as referer. The page sets a
 *    `filehosting` session cookie and embeds `finalDownloadUrl` (the page URL
 *    plus a `?pt=` token) behind a `seconds` countdown.
 * 2. After the countdown (enforced server side, an early request just gets
 *    the page again), GET the `?pt=` URL with the same cookie. It answers with
 *    a 302 to the file on a storage server (fsN.megadb.xyz), which needs no
 *    cookies and supports ranges.
 */
export class MegaDbApi {
  public static canHandle(uri: string): boolean {
    return isMegaDbUri(uri);
  }

  public static async getDownloadUrl(uri: string): Promise<string> {
    const id = this.canHandle(uri)
      ? new URL(uri).pathname.split("/").filter(Boolean)[0]
      : undefined;
    if (!id) throw new Error(`Invalid MegaDB URL: ${uri}`);

    const pageUrl = `${ORIGIN}/${id}`;

    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      try {
        return await this.resolve(pageUrl);
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === DownloadError.HosterUnlockFileNotFound
        ) {
          throw error;
        }
        logger.warn(`[MegaDB] Attempt ${attempt} for ${id} failed`, error);
      }
    }

    throw new Error(DownloadError.HosterUnlockUnavailable);
  }

  private static async resolve(pageUrl: string): Promise<string> {
    const page = await fetch(pageUrl, {
      redirect: "manual",
      headers: { "User-Agent": USER_AGENT, Referer: `${ORIGIN}/` },
    });
    const html = await page.text();

    if (page.status === 404) {
      throw new Error(DownloadError.HosterUnlockFileNotFound);
    }

    const location = page.headers.get("location");
    if (location) {
      const message = new URL(location, ORIGIN).searchParams.get("e") ?? "";
      if (/not found|removed|deleted|does not exist|expired/i.test(message)) {
        throw new Error(DownloadError.HosterUnlockFileNotFound);
      }
      throw new Error(
        `MegaDB redirected the file page: ${message || location}`
      );
    }

    const tokenUrl = html.match(/finalDownloadUrl\s*=\s*'([^']+)'/)?.[1];
    if (!tokenUrl) {
      throw new Error(
        `MegaDB page has no download link (status=${page.status})`
      );
    }

    const waitSeconds = Math.min(
      Number(
        html.match(/var\s+seconds\s*=\s*(\d+)/)?.[1] ?? DEFAULT_WAIT_SECONDS
      ),
      MAX_WAIT_SECONDS
    );
    const cookie = page.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");

    await sleep((waitSeconds + 1) * 1000);

    const response = await fetch(new URL(tokenUrl, ORIGIN).href, {
      redirect: "manual",
      headers: { "User-Agent": USER_AGENT, Referer: pageUrl, Cookie: cookie },
    });
    await response.body?.cancel();

    const fileUrl = response.headers.get("location");
    if (!fileUrl) {
      throw new Error(
        `MegaDB did not redirect to the file (status=${response.status})`
      );
    }

    const resolved = new URL(fileUrl, ORIGIN);
    if (resolved.pathname.startsWith("/error")) {
      throw new Error(
        `MegaDB refused the download: ${resolved.searchParams.get("e") ?? fileUrl}`
      );
    }
    return resolved.href;
  }
}
