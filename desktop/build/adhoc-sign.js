// afterPack hook: without a Developer ID certificate, electron-builder leaves the macOS app unsigned, and an unsigned
// Apple-silicon app refuses to start ("damaged"). Give the final (universal) app an ad-hoc signature instead.
// With CSC_LINK set, electron-builder signs (and notarizes) the app itself, and this hook does nothing.
const { execFileSync } = require("child_process");
const path = require("path");
exports.default = async function (context) {
  if (context.electronPlatformName !== "darwin") return;
  if (process.env.CSC_LINK) return;
  if (/-temp$/.test(context.appOutDir)) return;            // per-arch halves of a universal build: sign only the merged app
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  console.log(`  • ad-hoc signing ${app}`);
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "inherit" });
  execFileSync("codesign", ["--verify", "--deep", "--strict", app], { stdio: "inherit" });
};
