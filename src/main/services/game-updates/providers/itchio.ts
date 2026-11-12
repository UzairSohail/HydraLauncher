import {
  UpdateProviderError,
  type UpdateProvider,
} from "../update-provider.js";
import { asString, isRecord } from "./shared.js";

const NAME = /^[A-Za-z0-9_-]+$/;
const CHANNEL = /^[A-Za-z0-9_.-]+$/;

/**
 * Locators are `user/game:channel`. itch.io only exposes the latest version of
 * a butler channel without an API key, so updates open the game page.
 */
export const parseItchInput = (input: string) => {
  const value = input.trim();
  const separator = value.lastIndexOf(":");
  if (separator <= 0) return null;

  const target = value.slice(0, separator);
  const channel = value.slice(separator + 1);
  if (!CHANNEL.test(channel)) return null;

  let user: string | undefined;
  let game: string | undefined;
  const pageUrl = /^(?:https?:\/\/)?([^./]+)\.itch\.io\/([^/?#]+)\/?$/i.exec(
    target
  );
  if (pageUrl) {
    [, user, game] = pageUrl;
  } else {
    [user, game] = target.split("/");
    if (target.split("/").length !== 2) return null;
  }

  if (!user || !game || !NAME.test(user) || !NAME.test(game)) return null;
  return `${user.toLowerCase()}/${game.toLowerCase()}:${channel}`;
};

const splitLocator = (locator: string) => {
  const [target, channel] = locator.split(":");
  const [user, game] = target.split("/");
  return { target, channel, user, game };
};

export const itchioProvider: UpdateProvider = {
  id: "itchio",
  displayName: "itch.io",
  inputExample: "user/game:windows",
  supportsChannels: false,
  supportsDownloads: false,

  parseInput: parseItchInput,

  getSourceUrl: (locator) => {
    const { user, game } = splitLocator(locator);
    return `https://${user}.itch.io/${game}`;
  },

  async fetchLatest(locator, { http, signal }) {
    const { target, channel, user, game } = splitLocator(locator);
    const params = new URLSearchParams({ target, channel_name: channel });
    const payload = await http.getJson<unknown>(
      `https://itch.io/api/1/x/wharf/latest?${params}`,
      { headers: { Accept: "application/json" }, signal }
    );

    if (!isRecord(payload)) throw new UpdateProviderError("invalid_response");
    if (Array.isArray(payload.errors) && payload.errors.length > 0) {
      throw new UpdateProviderError("not_found", String(payload.errors[0]));
    }
    // Only builds pushed with `--userversion` report a version.
    const version = asString(payload.latest);
    if (!version) {
      throw new UpdateProviderError("invalid_response", "no_user_version");
    }

    return {
      version,
      tag: null,
      name: null,
      publishedAt: null,
      pageUrl: `https://${user}.itch.io/${game}`,
      notesMarkdown: null,
      isPrerelease: false,
      assets: [],
    };
  },
};
