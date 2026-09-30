// afterPack hook (macOS): sign the final (universal) app when electron-builder itself does not sign it.
//  - TF_SIGN_IDENTITY set (the release workflow imported the self-signed "GARASU" certificate into
//    TF_SIGN_KEYCHAIN): sign with that certificate. Every release then carries the same signature, which is
//    what macOS needs to install an update in place ("Restart now").
//  - otherwise: ad-hoc signature, so the app at least starts on Apple silicon (updates cannot install in place).
// With CSC_LINK set (a real Developer ID), electron-builder signs and notarizes itself and this hook does nothing.
const { execFileSync } = require("child_process");
const path = require("path");
exports.default = async function (context) {
  if (context.electronPlatformName !== "darwin") return;
  if (process.env.CSC_LINK) return;
  if (/-temp$/.test(context.appOutDir)) return;            // per-arch halves of a universal build: sign only the merged app
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const id = process.env.TF_SIGN_IDENTITY, kc = process.env.TF_SIGN_KEYCHAIN;
  const args = ["--force", "--deep", "--timestamp=none", "--sign", id || "-"];
  if (id && kc) args.push("--keychain", kc);
  console.log(`  • ${id ? "signing with the GARASU certificate" : "ad-hoc signing"} ${app}`);
  execFileSync("codesign", [...args, app], { stdio: "inherit" });
  execFileSync("codesign", ["--verify", "--deep", "--strict", "--verbose=2", app], { stdio: "inherit" });
  execFileSync("codesign", ["--display", "--requirements", "-", app], { stdio: "inherit" });
};
