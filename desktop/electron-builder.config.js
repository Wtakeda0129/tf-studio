// electron-builder configuration. Edit PUBLISH_* (or set the env vars) before the first release.
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
    target: [{ target: "dmg", arch: ["arm64", "x64"] }, { target: "zip", arch: ["arm64", "x64"] }],
    hardenedRuntime: true,
    gatekeeperAssess: false,
    notarize: canNotarize,          // needs a Developer ID certificate (CSC_LINK) + the three APPLE_* variables
  },
  dmg: { title: "Tf Studio ${version}" },
  // Where installed copies look for updates. GitHub Releases by default; see DESKTOP_README.md for alternatives.
  publish: [{ provider: "github", owner: PUBLISH_OWNER, repo: PUBLISH_REPO }],
};
