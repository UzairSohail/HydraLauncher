import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

import {
  MIGRATION_MARKER_FILE,
  migrateUserDataFolder,
} from "./user-data-migration.ts";

const roots: string[] = [];

const setup = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nacho-userdata-"));
  roots.push(root);
  return {
    root,
    legacyPath: path.join(root, "hydralauncher"),
    newPath: path.join(root, "nacho-launcher"),
  };
};

const seedLegacy = (legacyPath: string) => {
  fs.mkdirSync(path.join(legacyPath, "hydra-db"), { recursive: true });
  fs.writeFileSync(path.join(legacyPath, "hydra-db", "CURRENT"), "db");
  fs.mkdirSync(path.join(legacyPath, "logs"));
  fs.writeFileSync(path.join(legacyPath, "logs", "info.txt"), "log");
};

after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

describe("migrateUserDataFolder", () => {
  it("moves existing data and leaves a working link at the old path", () => {
    const { legacyPath, newPath } = setup();
    seedLegacy(legacyPath);

    const result = migrateUserDataFolder({ legacyPath, newPath });

    assert.equal(result.userDataPath, newPath);
    assert.equal(
      fs.readFileSync(path.join(newPath, "hydra-db", "CURRENT"), "utf8"),
      "db"
    );
    assert.ok(fs.lstatSync(legacyPath).isSymbolicLink());
    // Absolute paths saved against the old folder still resolve.
    assert.equal(
      fs.readFileSync(path.join(legacyPath, "logs", "info.txt"), "utf8"),
      "log"
    );
    assert.ok(fs.existsSync(path.join(newPath, MIGRATION_MARKER_FILE)));
  });

  it("is a no-op on the next launch", () => {
    const { legacyPath, newPath } = setup();
    seedLegacy(legacyPath);
    migrateUserDataFolder({ legacyPath, newPath });

    const second = migrateUserDataFolder({ legacyPath, newPath });

    assert.equal(second.userDataPath, newPath);
    assert.deepEqual(second.messages, []);
    assert.ok(fs.lstatSync(legacyPath).isSymbolicLink());
  });

  it("starts fresh installs in the new folder without creating the old name", () => {
    const { legacyPath, newPath } = setup();

    const result = migrateUserDataFolder({ legacyPath, newPath });

    assert.equal(result.userDataPath, newPath);
    assert.equal(fs.existsSync(legacyPath), false);
  });

  it("removes the empty old-named folder Electron creates on fresh installs", () => {
    const { legacyPath, newPath } = setup();
    fs.mkdirSync(legacyPath);

    const result = migrateUserDataFolder({ legacyPath, newPath });

    assert.equal(result.userDataPath, newPath);
    assert.equal(fs.existsSync(legacyPath), false);

    // Same on later launches, once the new folder has data.
    seedLegacy(newPath);
    fs.mkdirSync(legacyPath);
    migrateUserDataFolder({ legacyPath, newPath });
    assert.equal(fs.existsSync(legacyPath), false);
  });

  it("keeps using the old folder when the move fails", () => {
    const { legacyPath, newPath } = setup();
    seedLegacy(legacyPath);

    const result = migrateUserDataFolder({
      legacyPath,
      newPath,
      fsImpl: {
        ...fs,
        renameSync: () => {
          throw new Error("EBUSY");
        },
      },
    });

    assert.equal(result.userDataPath, legacyPath);
    assert.equal(fs.existsSync(newPath), false);
    assert.ok(fs.lstatSync(legacyPath).isDirectory());
  });

  it("never switches to an empty new folder over real old data", () => {
    const { legacyPath, newPath } = setup();
    seedLegacy(legacyPath);
    fs.mkdirSync(newPath);

    const result = migrateUserDataFolder({ legacyPath, newPath });

    assert.equal(result.userDataPath, legacyPath);
  });

  it("restores a missing link after an earlier migration", () => {
    const { legacyPath, newPath } = setup();
    seedLegacy(legacyPath);
    migrateUserDataFolder({ legacyPath, newPath });
    fs.unlinkSync(legacyPath);

    const result = migrateUserDataFolder({ legacyPath, newPath });

    assert.equal(result.userDataPath, newPath);
    assert.ok(fs.lstatSync(legacyPath).isSymbolicLink());
  });
});
