import updater, { UpdateInfo } from "electron-updater";
import { logger, WindowManager } from "@main/services";
import type {
  AppUpdaterEvent,
  ManualUpdateCheckResult,
  UserPreferences,
} from "@types";
import { app } from "electron";
import { publishNotificationUpdateReadyToInstall } from "@main/services/notifications";
import { db, levelKeys } from "@main/level";

const { autoUpdater } = updater;
const sendEventsForDebug = false;

export class UpdateManager {
  private static hasNotified = false;
  private static newVersion = "";
  private static isUpdateDownloaded = false;

  private static mockValuesForDebug() {
    this.sendEvent({ type: "update-available", info: { version: "3.3.1" } });
    this.sendEvent({ type: "update-downloaded" });
  }

  private static sendEvent(event: AppUpdaterEvent) {
    WindowManager.mainWindow?.webContents.send("autoUpdaterEvent", event);
  }

  private static async isAutoInstallEnabled() {
    if (process.platform === "darwin") return false;
    if (process.platform === "win32") {
      return process.env.PORTABLE_EXECUTABLE_FILE == null;
    }

    if (process.platform === "linux") {
      const userPreferences = await db.get<string, UserPreferences | null>(
        levelKeys.userPreferences,
        {
          valueEncoding: "json",
        }
      );

      return userPreferences?.enableAutoInstall === true;
    }

    return false;
  }

  private static registerListeners() {
    autoUpdater
      .removeAllListeners()
      .on("error", (error: Error) => {
        logger.error("Auto updater error", error);
      })
      .on("update-available", (info: UpdateInfo) => {
        this.sendEvent({ type: "update-available", info });
        this.newVersion = info.version;
      })
      .on("download-progress", (progress: { percent: number }) => {
        this.sendEvent({
          type: "download-progress",
          percent: progress.percent,
        });
      })
      .on("update-downloaded", () => {
        this.isUpdateDownloaded = true;
        this.sendEvent({ type: "update-downloaded" });

        if (!this.hasNotified) {
          this.hasNotified = true;
          publishNotificationUpdateReadyToInstall(this.newVersion);
        }
      });
  }

  public static async checkForUpdates() {
    this.registerListeners();

    const isAutoInstallAvailable = await this.isAutoInstallEnabled();

    if (app.isPackaged) {
      autoUpdater.autoDownload = isAutoInstallAvailable;
      autoUpdater.checkForUpdates().then((result) => {
        logger.log(`Check for updates result: ${result}`);
      });
    } else if (sendEventsForDebug) {
      this.mockValuesForDebug();
    }

    return isAutoInstallAvailable;
  }

  /**
   * Runs a check the user asked for and waits for its answer, so the title
   * bar can say whether Nacho is up to date. On installs that can update
   * themselves, a found update starts downloading straight away.
   */
  public static async checkForUpdatesManually(): Promise<ManualUpdateCheckResult> {
    if (this.isUpdateDownloaded) {
      return { status: "update-downloaded", version: this.newVersion };
    }

    if (!app.isPackaged) return { status: "not-packaged" };

    this.registerListeners();

    const isAutoInstallAvailable = await this.isAutoInstallEnabled();
    autoUpdater.autoDownload = isAutoInstallAvailable;

    try {
      const result = await autoUpdater.checkForUpdates();

      if (!result?.isUpdateAvailable) {
        return { status: "up-to-date", version: app.getVersion() };
      }

      this.newVersion = result.updateInfo.version;

      return {
        status: "update-available",
        version: result.updateInfo.version,
        isAutoInstallAvailable,
      };
    } catch (error) {
      logger.error("Manual update check failed", error);
      return {
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
