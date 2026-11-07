// Expo SDK 52 configure Metro pour les monorepos automatiquement (watchFolders = racine du workspace,
// nodeModulesPaths, suivi des symlinks pnpm). Ne pas rajouter watchFolders / extraNodeModules à la main.
const { getDefaultConfig } = require("expo/metro-config");

/** @type {import("expo/metro-config").MetroConfig} */
const config = getDefaultConfig(__dirname);

module.exports = config;
