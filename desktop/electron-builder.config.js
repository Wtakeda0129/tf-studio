// electron-builder configuration (macOS dmg/zip and Windows NSIS installer). Edit PUBLISH_* (or set the env vars) before the first release.
const PUBLISH_OWNER = process.env.GH_OWNER || "Wtakeda0129";
const PUBLISH_REPO = process.env.GH_REPO || "tf-studio";
const canNotarize = !!(process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID);

module.exports = {
  appId: "io.github.wtakeda0129.tfstudio",
  productName: "Tf Studio",
  copyright: "© 2026 Wataru Takeda, University of Arizona",
  files: ["main.js", "preload.js", "app/**/*"],
  directories: { buildResources: "build", output: "dist" },
  mac: {
    category: "public.app-category.education",
    icon: "build/icon.png",
    // dmg = what people download and install; zip + latest-mac.yml = what the auto-updater downloads
    // one universal build (Apple silicon + Intel): a single DMG and update ZIP, and no two DMG volumes mounted at once
    target: [{ target: "dmg", arch: ["universal"] }, { target: "zip", arch: ["universal"] }],
    hardenedRuntime: true,
    gatekeeperAssess: false,
    notarize: canNotarize,          // needs a Developer ID certificate (CSC_LINK) + the three APPLE_* variables
  },
  dmg: { title: "Tf Studio ${version}" },
  win: {
    icon: "build/icon.png",
    // NSIS installer: per-user install (no admin rights needed), Start-menu + desktop shortcuts, auto-update via latest.yml
    target: [{ target: "nsis", arch: ["x64"] }],
    // editing the .exe icon/metadata needs Windows (or Wine); skipped when building elsewhere
    signAndEditExecutable: process.platform === "win32",
    // code signing is optional on Windows; without it SmartScreen shows "unknown publisher" on first run
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: "Tf Studio",
    artifactName: "Tf-Studio-Setup-${version}.exe",
  },
  // Where installed copies look for updates. GitHub Releases by default; see DESKTOP_README.md for alternatives.
  publish: [{ provider: "github", owner: PUBLISH_OWNER, repo: PUBLISH_REPO, releaseType: "release" }],
};
