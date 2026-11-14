import { useState, useCallback, type ReactNode } from "react";
import { useFeature, useAppSelector } from "@renderer/hooks";
import {
  readStoredSectionCollapsed,
  storeSectionCollapsed,
} from "./collapsed-sections";
import { SettingsTorBox } from "./settings-torbox";
import { SettingsRealDebrid } from "./settings-real-debrid";
import { SettingsPremiumize } from "./settings-premiumize";
import { SettingsAllDebrid } from "./settings-all-debrid";
import { ChevronRightIcon, CheckCircleFillIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";
import "./settings-debrid.scss";

interface CollapseState {
  torbox: boolean;
  realDebrid: boolean;
  premiumize: boolean;
  allDebrid: boolean;
}

export function SettingsDebrid() {
  const { t } = useTranslation("settings");
  const { isFeatureEnabled, Feature } = useFeature();
  const isTorBoxEnabled = isFeatureEnabled(Feature.TorBox);
  const isPremiumizeEnabled = isFeatureEnabled(Feature.Premiumize);

  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const [collapseState, setCollapseState] = useState<CollapseState>(() => ({
    torbox: readStoredSectionCollapsed(
      "torbox",
      !userPreferences?.torBoxApiToken
    ),
    realDebrid: readStoredSectionCollapsed(
      "realDebrid",
      !userPreferences?.realDebridApiToken
    ),
    premiumize: readStoredSectionCollapsed(
      "premiumize",
      !userPreferences?.premiumizeApiToken
    ),
    // Open AllDebrid by default until some provider has a key, so a new
    // install shows where to paste one.
    allDebrid: readStoredSectionCollapsed(
      "allDebrid",
      !userPreferences?.allDebridApiToken &&
        Boolean(
          userPreferences?.realDebridApiToken ||
            userPreferences?.premiumizeApiToken ||
            userPreferences?.torBoxApiToken
        )
    ),
  }));

  const toggleSection = useCallback(
    (section: keyof CollapseState) => {
      const nextCollapsed = !collapseState[section];

      storeSectionCollapsed(section, nextCollapsed);
      setCollapseState((prevState) => ({
        ...prevState,
        [section]: nextCollapsed,
      }));
    },
    [collapseState]
  );

  const renderSection = (
    section: keyof CollapseState,
    providerKey: string,
    hasToken: boolean,
    content: ReactNode,
    recommended = false
  ) => {
    const collapsed = collapseState[section];
    const provider = t(providerKey);

    return (
      <div
        key={section}
        className={`settings-debrid__section ${
          collapsed ? "" : "settings-debrid__section--expanded"
        }`}
      >
        <div className="settings-debrid__section-header">
          <button
            type="button"
            className="settings-debrid__collapse-button"
            onClick={() => toggleSection(section)}
            aria-label={
              collapsed
                ? t("expand_debrid_section", { provider })
                : t("collapse_debrid_section", { provider })
            }
          >
            <span
              className={`settings-debrid__collapse-icon ${
                collapsed ? "" : "settings-debrid__collapse-icon--expanded"
              }`}
            >
              <ChevronRightIcon size={16} />
            </span>
          </button>
          <h3 className="settings-debrid__section-title">{provider}</h3>
          {recommended && (
            <span className="settings-debrid__recommended-badge">
              {t("debrid_recommended")}
            </span>
          )}
          {hasToken && (
            <CheckCircleFillIcon
              size={16}
              className="settings-debrid__check-icon"
            />
          )}
        </div>

        {!collapsed && content}
      </div>
    );
  };

  // AllDebrid is the recommended provider in this fork, so it comes first.
  return (
    <div className="settings-debrid">
      <p className="settings-debrid__description">{t("debrid_description")}</p>

      {renderSection(
        "allDebrid",
        "debrid_provider_alldebrid",
        Boolean(userPreferences?.allDebridApiToken),
        <SettingsAllDebrid />,
        true
      )}

      {renderSection(
        "realDebrid",
        "debrid_provider_real_debrid",
        Boolean(userPreferences?.realDebridApiToken),
        <SettingsRealDebrid />
      )}

      {isPremiumizeEnabled &&
        renderSection(
          "premiumize",
          "debrid_provider_premiumize",
          Boolean(userPreferences?.premiumizeApiToken),
          <SettingsPremiumize />
        )}

      {isTorBoxEnabled &&
        renderSection(
          "torbox",
          "debrid_provider_torbox",
          Boolean(userPreferences?.torBoxApiToken),
          <SettingsTorBox />
        )}
    </div>
  );
}
