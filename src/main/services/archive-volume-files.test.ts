import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isArchiveVolumeFile,
  isFirstArchiveVolume,
} from "./archive-volume-files.ts";

test("plain archives are extracted", () => {
  for (const name of ["Game.zip", "Game.7z", "Game.RAR"]) {
    assert.equal(isArchiveVolumeFile(name), true);
    assert.equal(isFirstArchiveVolume(name), true);
  }
});

test("only the first numbered part of a RAR set is extracted", () => {
  assert.equal(isFirstArchiveVolume("Game.part1.rar"), true);
  assert.equal(isFirstArchiveVolume("Game.part01.rar"), true);
  assert.equal(isFirstArchiveVolume("Game.part001.rar"), true);
  assert.equal(isFirstArchiveVolume("Game.part2.rar"), false);
  assert.equal(isFirstArchiveVolume("Game.part10.rar"), false);
  assert.equal(isArchiveVolumeFile("Game.part10.rar"), true);
});

test("split 7z, zip and rar volumes start at .001", () => {
  for (const ext of ["7z", "zip", "rar"]) {
    assert.equal(isFirstArchiveVolume(`Game.${ext}.001`), true);
    assert.equal(isFirstArchiveVolume(`Game.${ext}.002`), false);
    assert.equal(isArchiveVolumeFile(`Game.${ext}.002`), true);
  }
});

test("old-style RAR volumes are cleaned up but not extracted", () => {
  assert.equal(isFirstArchiveVolume("Game.rar"), true);
  assert.equal(isFirstArchiveVolume("Game.r00"), false);
  assert.equal(isArchiveVolumeFile("Game.r00"), true);
});

test("installers and game data are left alone", () => {
  for (const name of ["setup.exe", "fg-01.bin", "data.pak", "Game.001"]) {
    assert.equal(isArchiveVolumeFile(name), false);
    assert.equal(isFirstArchiveVolume(name), false);
  }
});
