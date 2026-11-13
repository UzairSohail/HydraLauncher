/** Short and mirror domains Buzzheavier serves the same file ids on. */
export const BUZZHEAVIER_HOSTS = ["buzzheavier.com", "bzzhr.co", "bzzhr.to"];

const hostnameOf = (uri: string) => {
  try {
    const url = new URL(uri);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
};

export const isBuzzheavierUri = (uri: string) => {
  const host = hostnameOf(uri);
  return host !== null && BUZZHEAVIER_HOSTS.includes(host);
};

export const isMegaDbUri = (uri: string) => hostnameOf(uri) === "megadb.net";
