// The phone app shares src/shared/companion.ts with the launcher, so Metro
// needs to see that folder too.
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
config.watchFolders = [path.resolve(__dirname, "../src/shared")];

module.exports = config;
