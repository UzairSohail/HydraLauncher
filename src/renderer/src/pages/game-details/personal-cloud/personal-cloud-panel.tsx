import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CloudArrowDownIcon,
  CloudArrowUpIcon,
  FolderOpenIcon,
  ArrowsClockwiseIcon,
  CircleNotchIcon,
} from "@phosphor-icons/react";

import { Button, ConfirmationModal } from "@renderer/components";
import { useDate, useToast } from "@renderer/hooks";
import { formatBytes } from "@shared";
import type { GameShop } from "@types";

import { usePersonalCloudGame } from "./use-personal-cloud-game";
import "./personal-cloud.scss";

interface PersonalCloudPanelProps {
  shop: GameShop;
  objectId: string;
  executablePath?: string | null;
  onSelectExecutable: () => void;
}

interface PendingConfirmation {
  description: string;
  action: () => Promise<unknown>;
  danger?: boolean;
}

export function PersonalCloudPanel({
  shop,
  objectId,
  executablePath,
  onSelectExecutable,
}: Readonly<PersonalCloudPanelProps>) {
  const { t } = useTranslation("personal_cloud");
  const { formatDateTime } = useDate();
  const { showErrorToast } = useToast();
  const { state, isLoading, isBusy, error, run } = usePersonalCloudGame(
    shop,
    objectId,
    executablePath
  );
  const [confirmation, setConfirmation] = useState<PendingConfirmation | null>(
    null
  );
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [unclear, setUnclear] = useState<string[]>([]);

  const perform = async (action: () => Promise<unknown>) => {
    try {
      await run(action);
    } catch (err) {
      showErrorToast(
        t("action_failed", {
          message: err instanceof Error ? err.message : String(err),
        })
      );
    }
  };

  const signIn = async () => {
    setIsSigningIn(true);
    try {
      await run(() => window.electron.signInPersonalCloud());
    } catch {
      showErrorToast(t("sign_in_failed"));
    } finally {
      setIsSigningIn(false);
    }
  };

  const syncNow = () =>
    perform(async () => {
      const result = await window.electron.syncPersonalCloudGame(
        shop,
        objectId
      );
      setUnclear(result.unclear);
    });

  const chooseSaveFolder = () =>
    perform(() =>
      window.electron.choosePersonalCloudSaveFolder(shop, objectId)
    );

  const confirm = (pending: PendingConfirmation) => setConfirmation(pending);

  const renderBody = () => {
    if (!state && isLoading) {
      return (
        <p className="personal-cloud__note personal-cloud__loading">
          <CircleNotchIcon size={16} className="personal-cloud__spinner" />
          {t("checking")}
        </p>
      );
    }
    if (error && !state) {
      return <p className="personal-cloud__note">{error}</p>;
    }
    if (!state?.status.signedIn) {
      return (
        <div className="personal-cloud__empty">
          <p className="personal-cloud__note">{t("sign_in_to_use")}</p>
          <Button onClick={signIn} disabled={isSigningIn}>
            {isSigningIn ? t("signing_in") : t("sign_in")}
          </Button>
        </div>
      );
    }
    if (!executablePath) {
      return (
        <div className="personal-cloud__empty">
          <p className="personal-cloud__note">{t("needs_executable")}</p>
          <Button theme="outline" onClick={onSelectExecutable}>
            {t("choose_executable")}
          </Button>
        </div>
      );
    }
    const info = state.info;
    if (!info) {
      return <p className="personal-cloud__note">{t("unsupported")}</p>;
    }
    if (!info.inCatalogue) {
      return (
        <div className="personal-cloud__empty">
          <p className="personal-cloud__note">
            {unclear.length > 0
              ? t("unclear_folders", { folders: unclear.join(", ") })
              : t("learning")}
          </p>
          <Button theme="outline" onClick={chooseSaveFolder} disabled={isBusy}>
            <FolderOpenIcon size={16} />
            {t("choose_save_folder")}
          </Button>
        </div>
      );
    }

    return (
      <>
        <div className="personal-cloud__summary">
          <span
            className={`personal-cloud__status personal-cloud__status--${info.status}`}
          >
            {state.status.paused
              ? t("paused")
              : t(`status_${info.status}`, { defaultValue: info.statusLabel })}
          </span>
          {info.saveLocation && (
            <span className="personal-cloud__meta" title={info.folder ?? ""}>
              {t("save_location")}: {info.saveLocation}
            </span>
          )}
          {info.localFiles > 0 && (
            <span className="personal-cloud__meta">
              {t("local_files", {
                count: info.localFiles,
                size: formatBytes(info.localBytes),
              })}
            </span>
          )}
          {info.settled && (
            <span className="personal-cloud__meta">
              {info.settled.keptLocal ? t("settled_local") : t("settled_cloud")}
            </span>
          )}
        </div>

        <div className="personal-cloud__actions">
          <Button onClick={syncNow} disabled={isBusy || state.status.paused}>
            <ArrowsClockwiseIcon size={16} />
            {isBusy ? t("syncing") : t("sync_now")}
          </Button>
          <Button
            theme="outline"
            disabled={isBusy}
            onClick={() =>
              confirm({
                description: t("force_upload_confirm"),
                action: () =>
                  window.electron.forcePersonalCloudUpload(shop, objectId),
              })
            }
          >
            <CloudArrowUpIcon size={16} />
            {t("force_upload")}
          </Button>
          <Button
            theme="outline"
            disabled={isBusy || info.versions.length === 0}
            onClick={() =>
              confirm({
                description: t("force_download_confirm"),
                action: () =>
                  window.electron.forcePersonalCloudDownload(shop, objectId),
              })
            }
          >
            <CloudArrowDownIcon size={16} />
            {t("force_download")}
          </Button>
          <Button theme="outline" onClick={chooseSaveFolder} disabled={isBusy}>
            <FolderOpenIcon size={16} />
            {t("choose_save_folder")}
          </Button>
        </div>

        <h3 className="personal-cloud__heading">{t("versions")}</h3>
        {info.versions.length === 0 ? (
          <p className="personal-cloud__note">{t("no_versions")}</p>
        ) : (
          <ul className="personal-cloud__versions">
            {info.versions.map((version) => (
              <li key={version.id} className="personal-cloud__version">
                <div className="personal-cloud__version-text">
                  <span>
                    {t("version_details", {
                      device: version.device,
                      date: formatDateTime(version.createdMs),
                      size: formatBytes(version.size),
                    })}
                  </span>
                  {version.isCurrent && (
                    <span className="personal-cloud__badge">
                      {t("current")}
                    </span>
                  )}
                </div>
                {!version.isCurrent && (
                  <div className="personal-cloud__version-actions">
                    <Button
                      theme="outline"
                      disabled={isBusy}
                      onClick={() =>
                        confirm({
                          description: t("restore_confirm"),
                          action: () =>
                            window.electron.restorePersonalCloudVersion(
                              shop,
                              objectId,
                              version.id
                            ),
                        })
                      }
                    >
                      {t("restore")}
                    </Button>
                    <Button
                      theme="danger"
                      disabled={isBusy}
                      onClick={() =>
                        confirm({
                          description: t("delete_confirm"),
                          danger: true,
                          action: () =>
                            window.electron.deletePersonalCloudVersion(
                              shop,
                              objectId,
                              version.id
                            ),
                        })
                      }
                    >
                      {t("delete")}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </>
    );
  };

  return (
    <div className="personal-cloud">
      <p className="personal-cloud__note">{t("panel_description")}</p>
      {renderBody()}

      <ConfirmationModal
        visible={confirmation !== null}
        title={t("title")}
        descriptionText={confirmation?.description ?? ""}
        confirmButtonLabel={t("confirm")}
        cancelButtonLabel={t("cancel")}
        confirmButtonTheme={confirmation?.danger ? "danger" : "primary"}
        onClose={() => setConfirmation(null)}
        onCancel={() => setConfirmation(null)}
        onConfirm={() => {
          const pending = confirmation;
          setConfirmation(null);
          if (pending) void perform(pending.action);
        }}
      />
    </div>
  );
}
