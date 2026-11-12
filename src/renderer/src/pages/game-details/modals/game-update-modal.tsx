import { useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertIcon, CheckCircleIcon } from "@primer/octicons-react";

import { Button, Modal } from "@renderer/components";
import { gameDetailsContext } from "@renderer/context";
import { useDate } from "@renderer/hooks";
import type { GameRepack } from "@types";

import {
  DownloadSettingsModal,
  type DownloadSettingsModalProps,
} from "./download-settings-modal";
import "./game-update-modal.scss";

export interface GameUpdateModalProps {
  visible: boolean;
  onClose: () => void;
  startDownload: DownloadSettingsModalProps["startDownload"];
}

/**
 * Offers the newer version a game's download source lists. Updating backs up
 * the saves, removes the installed files and downloads the new version.
 */
export function GameUpdateModal({
  visible,
  onClose,
  startDownload,
}: Readonly<GameUpdateModalProps>) {
  const { t } = useTranslation("game_details");
  const { formatDate } = useDate();
  const { game, repacks, updateGame } = useContext(gameDetailsContext);
  const [showDownloadSettings, setShowDownloadSettings] = useState(false);
  const [savesBackedUp, setSavesBackedUp] = useState<boolean | null>(null);
  const [skipping, setSkipping] = useState(false);

  const update = game?.availableUpdate ?? null;
  const installed = game?.installedRepack ?? null;
  const repack: GameRepack | null =
    repacks.find((candidate) => candidate.id === update?.id) ?? null;

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    window.electron
      .getPersonalCloudStatus()
      .then((status) => {
        if (!cancelled) setSavesBackedUp(status.signedIn && !status.paused);
      })
      .catch(() => {
        if (!cancelled) setSavesBackedUp(false);
      });
    return () => {
      cancelled = true;
    };
  }, [visible]);

  const handleSkip = async () => {
    if (!game) return;
    setSkipping(true);
    try {
      await window.electron.skipGameUpdate(game.shop, game.objectId);
      await updateGame();
      onClose();
    } finally {
      setSkipping(false);
    }
  };

  if (!update) return null;

  return (
    <>
      <DownloadSettingsModal
        visible={showDownloadSettings}
        onClose={() => setShowDownloadSettings(false)}
        startDownload={async (...args) => {
          const response = await startDownload(...args);
          if (response.ok) onClose();
          return response;
        }}
        repack={repack}
      />

      <Modal
        visible={visible && !showDownloadSettings}
        title={t("game_update_title")}
        description={t("game_update_description", {
          source: update.downloadSourceName,
        })}
        onClose={onClose}
      >
        <div className="game-update-modal">
          <div className="game-update-modal__versions">
            {installed && (
              <div className="game-update-modal__version">
                <span className="game-update-modal__label">
                  {t("game_update_installed")}
                </span>
                <span>{installed.title}</span>
              </div>
            )}
            <div className="game-update-modal__version game-update-modal__version--new">
              <span className="game-update-modal__label">
                {t("game_update_available")}
              </span>
              <span>{update.title}</span>
              <span className="game-update-modal__meta">
                {[
                  update.fileSize,
                  update.uploadDate ? formatDate(update.uploadDate) : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </div>
          </div>

          {savesBackedUp === true && (
            <p className="game-update-modal__note">
              <CheckCircleIcon size={16} />
              {t("game_update_saves_backed_up")}
            </p>
          )}
          {savesBackedUp === false && (
            <p className="game-update-modal__note game-update-modal__note--warning">
              <AlertIcon size={16} />
              {t("game_update_saves_not_backed_up")}
            </p>
          )}

          <p className="game-update-modal__hint">{t("game_update_hint")}</p>

          {!repack && (
            <p className="game-update-modal__note game-update-modal__note--warning">
              <AlertIcon size={16} />
              {t("game_update_listing_missing")}
            </p>
          )}

          <div className="game-update-modal__actions">
            <Button
              theme="outline"
              onClick={() => void handleSkip()}
              disabled={skipping}
            >
              {t("game_update_skip")}
            </Button>
            <Button theme="outline" onClick={onClose}>
              {t("game_update_later")}
            </Button>
            <Button
              onClick={() => setShowDownloadSettings(true)}
              disabled={!repack || savesBackedUp === null}
            >
              {t("game_update_confirm")}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
