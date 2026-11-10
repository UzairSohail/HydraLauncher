import type { PersonalCloudGameState } from "@types";

export type PersonalCloudTone = "synced" | "outdated" | "conflict" | "neutral";

export interface PersonalCloudPresentation {
  labelKey: string;
  tone: PersonalCloudTone;
}

/** What the game page button shows for a game's cloud save state. */
export const getPersonalCloudPresentation = (
  state: PersonalCloudGameState | null,
  isBusy: boolean,
  isLoading = false
): PersonalCloudPresentation => {
  if (isBusy) return { labelKey: "syncing", tone: "neutral" };
  if (!state && isLoading) return { labelKey: "checking", tone: "neutral" };
  if (!state?.status.signedIn)
    return { labelKey: "widget_off", tone: "neutral" };
  if (state.status.paused) return { labelKey: "paused", tone: "outdated" };
  const info = state.info;
  if (!info) return { labelKey: "widget_off", tone: "neutral" };
  if (!info.inCatalogue) {
    return { labelKey: "status_no_saves_yet", tone: "neutral" };
  }
  switch (info.status) {
    case "up_to_date":
      return { labelKey: "status_up_to_date", tone: "synced" };
    case "upload_waiting":
    case "cloud_newer":
    case "offline":
      return { labelKey: `status_${info.status}`, tone: "outdated" };
    case "both_changed":
      return { labelKey: "status_both_changed", tone: "conflict" };
    default:
      return { labelKey: `status_${info.status}`, tone: "neutral" };
  }
};
