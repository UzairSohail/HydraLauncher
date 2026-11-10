import { useContext } from "react";
import { useTranslation } from "react-i18next";

import { gameDetailsContext } from "@renderer/context";

import { CloudSaveStatusIcon } from "../cloud-save-v2/cloud-save-status-icon";
import type { CloudSavePresentationIcon } from "../cloud-save-v2/cloud-save-presentation";
import {
  getPersonalCloudPresentation,
  type PersonalCloudTone,
} from "./personal-cloud-presentation";
import { usePersonalCloudGame } from "./use-personal-cloud-game";
import "../cloud-save-v2/cloud-save-v2.scss";

const iconByTone: Record<PersonalCloudTone, CloudSavePresentationIcon> = {
  synced: "synced",
  outdated: "warning",
  conflict: "warning",
  neutral: "cloud",
};

/** The game page button for cloud saves. It opens the game's cloud settings. */
export function PersonalCloudWidget() {
  const { t } = useTranslation("personal_cloud");
  const {
    game,
    shop,
    objectId,
    setGameOptionsInitialCategory,
    setShowGameOptionsModal,
  } = useContext(gameDetailsContext);
  const { state, isBusy, isLoading } = usePersonalCloudGame(
    shop,
    objectId,
    game?.executablePath
  );
  const presentation = getPersonalCloudPresentation(state, isBusy, isLoading);

  return (
    <button
      type="button"
      className={`game-details__cloud-sync-button cloud-save-v2__trigger cloud-save-v2__trigger--${presentation.tone}`}
      onClick={() => {
        setGameOptionsInitialCategory("personal_cloud");
        setShowGameOptionsModal(true);
      }}
      title={t("title")}
    >
      <CloudSaveStatusIcon
        icon={
          isBusy || (!state && isLoading)
            ? "spinner"
            : iconByTone[presentation.tone]
        }
      />
      {t(presentation.labelKey)}
    </button>
  );
}
