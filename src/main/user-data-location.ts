// Must be the first import of the main entry: it decides where userData lives
// before any other module reads app.getPath("userData").
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import {
  LEGACY_USER_DATA_FOLDER,
  USER_DATA_FOLDER,
  migrateUserDataFolder,
} from "./helpers/user-data-migration";

/** Collected here and written to the log once the logger exists. */
export const userDataMigrationMessages: string[] = [];

const setUserDataPath = (target: string) => {
  app.setPath("userData", target);
  app.setPath("sessionData", target);
};

// Opt-in isolation for local API testing; packaged installs keep their paths.
const developmentUserDataPath = import.meta.env.MAIN_VITE_USER_DATA_PATH;

if (!app.isPackaged && developmentUserDataPath) {
  fs.mkdirSync(developmentUserDataPath, { recursive: true, mode: 0o700 });
  setUserDataPath(developmentUserDataPath);
} else {
  try {
    const appData = app.getPath("appData");
    const { userDataPath, messages } = migrateUserDataFolder({
      legacyPath: path.join(appData, LEGACY_USER_DATA_FOLDER),
      newPath: path.join(appData, USER_DATA_FOLDER),
    });
    userDataMigrationMessages.push(...messages);
    setUserDataPath(userDataPath);
  } catch (error) {
    // Never block startup: fall back to Electron's default folder.
    userDataMigrationMessages.push(
      `Data folder migration skipped: ${String(error)}`
    );
  }
}
