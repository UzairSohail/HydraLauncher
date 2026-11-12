import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  DownloadIcon,
  LinkExternalIcon,
  SyncIcon,
  TrashIcon,
} from "@primer/octicons-react";
import type { RecompilationActionResult, UpdateSourceState } from "@types";

import { Button } from "@renderer/components/button/button";
import { CheckboxField } from "@renderer/components/checkbox-field/checkbox-field";
import { Modal } from "@renderer/components/modal/modal";
import { SelectField } from "@renderer/components/select-field/select-field";
import { TextField } from "@renderer/components/text-field/text-field";
import { useDate, useToast } from "@renderer/hooks";
import type { RecompilationUpdates } from "./use-recompilation-updates";
import "./update-sources-modal.scss";

interface UpdateSourcesModalProps {
  visible: boolean;
  onClose: () => void;
  updates: RecompilationUpdates;
  onInstallResult: (result: RecompilationActionResult) => void;
}

const SOURCE_ERROR_KEYS: Record<string, string> = {
  invalid_source: "update_source_invalid",
  duplicate_source: "update_source_duplicate",
  too_many_sources: "update_source_too_many",
  unknown_provider: "update_source_unknown_provider",
};

function SourceRow({
  source,
  installedVersion,
  isInstalledSource,
  updates,
  onInstallResult,
}: Readonly<{
  source: UpdateSourceState;
  installedVersion: string | null;
  isInstalledSource: boolean;
  updates: RecompilationUpdates;
  onInstallResult: (result: RecompilationActionResult) => void;
}>) {
  const { t } = useTranslation("recompilation");
  const { formatDistance } = useDate();
  const [filter, setFilter] = useState(source.assetFilter ?? "");
  const [isInstalling, setIsInstalling] = useState(false);
  const provider = updates.providers.find(
    (item) => item.id === source.providerId
  );
  const latest = source.status.latest;

  useEffect(() => setFilter(source.assetFilter ?? ""), [source.assetFilter]);

  const install = async () => {
    setIsInstalling(true);
    try {
      onInstallResult(await updates.installFrom(source.id));
    } finally {
      setIsInstalling(false);
    }
  };

  const renderStatus = () => {
    if (!source.isProviderAvailable) return t("update_source_provider_missing");
    if (source.status.error) {
      return t("update_source_check_failed", { reason: source.status.error });
    }
    if (!latest) {
      return source.status.checkedAt
        ? t("update_source_no_releases")
        : t("update_source_not_checked");
    }
    if (source.hasUpdate) {
      return t("update_source_update_available", { version: latest.version });
    }
    return t("update_source_latest", { version: latest.version });
  };

  const canInstall =
    latest !== null &&
    source.installAsset !== null &&
    (source.hasUpdate || latest.version !== installedVersion);
  const isManual =
    latest !== null && source.installAsset === null && Boolean(latest.pageUrl);

  return (
    <li className="update-sources__item">
      <div className="update-sources__item-header">
        <div className="update-sources__item-title">
          <span className="update-sources__provider">
            {source.isImplicit
              ? t("update_source_catalog")
              : source.providerName}
          </span>
          {!source.isImplicit && (
            <span className="update-sources__locator">{source.locator}</span>
          )}
          {isInstalledSource && (
            <span className="update-sources__tag">
              {t("update_source_installed_from")}
            </span>
          )}
          {source.channel === "prerelease" && (
            <span className="update-sources__tag">
              {t("update_source_prerelease_tag")}
            </span>
          )}
        </div>

        <div className="update-sources__item-actions">
          {canInstall && (
            <Button
              theme={source.hasUpdate ? "primary" : "outline"}
              onClick={install}
              disabled={isInstalling}
            >
              <DownloadIcon />
              {t("update_source_install", { version: latest.version })}
            </Button>
          )}
          {isManual && source.hasUpdate && (
            <Button
              theme="outline"
              onClick={() => void window.electron.openExternal(latest.pageUrl!)}
            >
              <LinkExternalIcon />
              {t("update_source_open_page")}
            </Button>
          )}
          {source.sourceUrl && (
            <Button
              theme="outline"
              className="update-sources__icon-button"
              aria-label={t("update_source_open_releases")}
              title={t("update_source_open_releases")}
              onClick={() =>
                void window.electron.openExternal(source.sourceUrl!)
              }
            >
              <LinkExternalIcon />
            </Button>
          )}
          {!source.isImplicit && (
            <Button
              theme="outline"
              className="update-sources__icon-button"
              aria-label={t("update_source_remove")}
              title={t("update_source_remove")}
              onClick={() => void updates.removeSource(source.id)}
            >
              <TrashIcon />
            </Button>
          )}
        </div>
      </div>

      <p className="update-sources__status">
        {renderStatus()}
        {source.status.checkedAt !== null && (
          <span className="update-sources__checked">
            {" · "}
            {t("update_source_checked_ago", {
              time: formatDistance(source.status.checkedAt, new Date(), {
                addSuffix: true,
              }),
            })}
          </span>
        )}
      </p>
      {latest && !source.installAsset && provider?.supportsDownloads && (
        <p className="update-sources__hint">{t("update_source_no_file")}</p>
      )}

      {!source.isImplicit && provider && (
        <div className="update-sources__item-options">
          {provider.supportsChannels && (
            <CheckboxField
              label={t("update_source_include_prereleases")}
              checked={source.channel === "prerelease"}
              onChange={(event) =>
                void updates.updateSource(source.id, {
                  channel: event.target.checked ? "prerelease" : "stable",
                })
              }
            />
          )}
          {provider.supportsDownloads && (
            <TextField
              theme="dark"
              value={filter}
              placeholder={t("update_source_filter_placeholder")}
              onChange={(event) => setFilter(event.target.value)}
              onBlur={() => {
                if (filter !== (source.assetFilter ?? "")) {
                  void updates.updateSource(source.id, {
                    assetFilter: filter || null,
                  });
                }
              }}
            />
          )}
        </div>
      )}
    </li>
  );
}

export function UpdateSourcesModal({
  visible,
  onClose,
  updates,
  onInstallResult,
}: Readonly<UpdateSourcesModalProps>) {
  const { t } = useTranslation("recompilation");
  const { showErrorToast, showSuccessToast } = useToast();
  const { state } = updates;

  const choosable = useMemo(
    () => updates.providers.filter((provider) => !provider.isImplicit),
    [updates.providers]
  );
  const [providerId, setProviderId] = useState("");
  const [input, setInput] = useState("");
  const [prerelease, setPrerelease] = useState(false);
  const [assetFilter, setAssetFilter] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  const provider =
    choosable.find((item) => item.id === providerId) ?? choosable[0] ?? null;

  const addSource = async () => {
    if (!provider || !input.trim()) return;
    setIsAdding(true);
    try {
      const result = await updates.addSource({
        providerId: provider.id,
        input,
        channel: prerelease ? "prerelease" : "stable",
        assetFilter: assetFilter || null,
      });
      if (result.ok) {
        setInput("");
        setAssetFilter("");
        setPrerelease(false);
        showSuccessToast(t("update_source_added"));
      } else {
        showErrorToast(
          t(SOURCE_ERROR_KEYS[result.reason] ?? "update_source_add_failed")
        );
      }
    } finally {
      setIsAdding(false);
    }
  };

  const installedSource = state?.sources.find(
    (source) => source.id === state.installedSourceId
  );

  return (
    <Modal
      visible={visible}
      title={t("update_sources_title")}
      description={t("update_sources_description")}
      onClose={onClose}
    >
      <div className="update-sources">
        <div className="update-sources__summary">
          <span>
            {state?.installedVersion
              ? t("update_sources_installed", {
                  version: state.installedVersion,
                  source: installedSource?.isImplicit
                    ? t("update_source_catalog")
                    : (installedSource?.providerName ?? "—"),
                })
              : t("update_sources_not_installed")}
          </span>
          <Button
            theme="outline"
            onClick={() => void updates.checkNow()}
            disabled={updates.isChecking || !state?.installedVersion}
          >
            <SyncIcon />
            {updates.isChecking
              ? t("update_sources_checking")
              : t("update_sources_check_now")}
          </Button>
        </div>

        <ul className="update-sources__list">
          {state?.sources.map((source) => (
            <SourceRow
              key={source.id}
              source={source}
              installedVersion={state.installedVersion}
              isInstalledSource={source.id === state.installedSourceId}
              updates={updates}
              onInstallResult={onInstallResult}
            />
          ))}
        </ul>

        {provider && (
          <section className="update-sources__add">
            <h3 className="update-sources__add-title">
              {t("update_source_add_title")}
            </h3>
            <div className="update-sources__add-row">
              <SelectField
                theme="dark"
                value={provider.id}
                onChange={(event) => setProviderId(event.target.value)}
                options={choosable.map((item) => ({
                  key: item.id,
                  value: item.id,
                  label: item.displayName,
                }))}
              />
              <TextField
                theme="dark"
                value={input}
                placeholder={t("update_source_input_placeholder", {
                  example: provider.inputExample,
                })}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void addSource();
                }}
              />
            </div>
            {provider.supportsDownloads && (
              <TextField
                theme="dark"
                value={assetFilter}
                placeholder={t("update_source_filter_placeholder")}
                hint={t("update_source_filter_hint")}
                onChange={(event) => setAssetFilter(event.target.value)}
              />
            )}
            {!provider.supportsDownloads && (
              <p className="update-sources__hint">
                {t("update_source_manual_hint")}
              </p>
            )}
            <div className="update-sources__add-footer">
              {provider.supportsChannels ? (
                <CheckboxField
                  label={t("update_source_include_prereleases")}
                  checked={prerelease}
                  onChange={(event) => setPrerelease(event.target.checked)}
                />
              ) : (
                <span />
              )}
              <Button onClick={addSource} disabled={isAdding || !input.trim()}>
                {t("update_source_add")}
              </Button>
            </div>
          </section>
        )}
      </div>
    </Modal>
  );
}
