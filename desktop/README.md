# GARASU: desktop app (macOS and Windows)

A desktop wrapper (Electron) around the website in `../site`: the home page (`index.html`), **Learn** (`learn.html`), the **Lab** (`explorer.html`) and the **Fitter** (`fitter.html`).

The app opens one window on the home page. The tool bar on the left switches between Learn, Lab, Fitter and Data Analysis inside that window (⌘1–⌘4, ⌘0 home); each tool is kept loaded, so its state survives switching. The app checks for updates on launch and every 6 hours, and has **Check for Updates…** in the app menu.

```
desktop/
├── main.js                      one window with a view per page, menus, auto-update (electron-updater)
├── preload.js                   bridge for the home page (version, update check)
├── app/                         copied from ../site by sync_apps.sh (not committed)
├── build/icon.png               app icon (1024 px)
├── build/adhoc-sign.js          afterPack hook: ad-hoc signature when no Developer ID certificate is configured
├── electron-builder.config.js   packaging: dmg + zip, signing/notarization, update feed
├── ../.github/workflows/release.yml  builds and publishes macOS + Windows when the version in package.json changes
├── sync_apps.sh                 copies ../site into app/
└── make_dmg_linux.sh            unsigned test DMGs without a Mac (how the test builds were made)
```

## 1. Current releases (ad-hoc signed)

Every release on GitHub has `GARASU-<version>-universal.dmg` (Apple silicon and Intel) and `GARASU-Setup-<version>.exe` (Windows). Locally, `npm ci && ./sync_apps.sh && npm run dist` on a Mac gives the same DMG; `make_dmg_linux.sh` builds test DMGs without a Mac.

Until a Developer ID certificate is configured, the macOS app has only an ad-hoc signature. So on first launch:

1. Open the DMG and drag the app into Applications.
2. Double-click the app. macOS will say it cannot verify the developer.
3. Go to **System Settings → Privacy & Security** and click **Open Anyway**.

   Alternatively, run `xattr -dr com.apple.quarantine "/Applications/GARASU.app"` in Terminal.

**Auto-update does not work in these builds.** macOS only installs an update if it is signed with the same Developer ID as the installed app.

### Self-signed certificate (free, current setup)

Without a Developer ID, the release workflow can sign every macOS build with the same self-signed certificate
(secret `MAC_SELFSIGN_P12`: a base64-encoded `.p12` with password `tfstudio` and the certificate name
`Tf Studio (self-signed)`). Every version then carries the same signature, so installed copies can install updates
in place ("Restart now"). First-time users still see the "unidentified developer" warning and use **Open Anyway**
once. Without the secret, builds fall back to an ad-hoc signature and the app points to the download page instead.

## 2. Real releases with automatic updates

### What you need (one time)

1. **Apple Developer Program membership** (Individual or through the university). It gives you a *Developer ID Application* certificate. Without it, macOS blocks the app for other users and auto-update cannot install anything.
2. **This repository** (`wtakeda-research/GARASU`). The release workflow is already in `.github/workflows/release.yml`.
3. **Repository secrets**, set under GitHub → Settings → Secrets and variables → Actions:

| Secret | What it is |
|---|---|
| `MAC_CERT_P12_BASE64` | Developer ID Application certificate exported from Keychain as `.p12`, then `base64 -i cert.p12 \| pbcopy` |
| `MAC_CERT_PASSWORD` | password you chose when exporting the `.p12` |
| `APPLE_ID` | your Apple ID e-mail |
| `APPLE_APP_SPECIFIC_PASSWORD` | created at appleid.apple.com → Sign-In and Security → App-Specific Passwords |
| `APPLE_TEAM_ID` | 10-character Team ID shown in the developer account |

### Publishing an update

The release workflow runs whenever `desktop/package.json` changes on `main`. You can also run it by hand: **Actions → Release desktop app → Run workflow**. It creates GitHub Release `v<version>`.


```bash
cd desktop
npm version patch --no-git-tag-version   # 1.0.0 → 1.0.1 in package.json
git commit -am "Release 1.0.1" && git push   # a version change on main triggers the release workflow
```

The workflow uploads the DMGs, the update ZIPs and `latest-mac.yml` to a GitHub Release. Every installed copy then does the following on its own:

1. Reads `latest-mac.yml`.
2. Sees the newer version.
3. Downloads it in the background.
4. Offers **Restart now** to install it.

Nobody has to download a new DMG.

You can also build locally on your Mac with `npm ci && npm run release`, using the same environment variables as the workflow.

## Windows

- The release workflow also builds `GARASU-Setup-<version>.exe` on a Windows runner. This is a per-user installer with Start-menu and desktop shortcuts, and it needs no admin rights.
- **Auto-update works on Windows without code signing.** Installed copies read `latest.yml` from the newest release.
- Unsigned installers show a SmartScreen "unknown publisher" warning. Users click **More info → Run anyway**. To remove the warning, buy a code-signing certificate and add `WIN_CERT_P12_BASE64` and `WIN_CERT_PASSWORD` as repository secrets.
- Local Windows build on a Windows PC: `cd desktop && npm ci && bash sync_apps.sh && npm run dist:win`.

## 3. Updates vs. accounts

Updates do **not** require user accounts. Each installed copy checks the update feed. The question is who can reach that feed and the app itself.

| Option | Who can install / update | Effort |
|---|---|---|
| **Public GitHub repository + Releases** (current config) | anyone with the link | none beyond the steps above |
| **Private repo or private file host** (`provider: "generic"`, URL on university web space / S3 / Cloudflare R2) | anyone you give the link to; the URL is unlisted, not protected | small change in `electron-builder.config.js` |
| **Licensed accounts** (e.g. [Keygen](https://keygen.sh), which electron-builder supports as `provider: "keygen"`) | only people you issue a license/account to; you can revoke access and see who is active | account with the service; a license-key prompt in the app |
| **Your own login** (e.g. Supabase or Firebase Auth + a small update endpoint) | same as above, fully under your control | the most work: a server and sign-in UI |

For sharing with collaborators and students, the public GitHub route is simplest. If you need to control who uses the software, the licensed-accounts route is the least work.

## 4. Changing the app

- Rebuild the tools with `python3 src/explorer/make_app.py` and `python3 src/fitter/make_fitter.py` (both write to `site/`). The release workflow copies `site/` into the app automatically.
- Try it without packaging: `npm ci && npm start`.
- Bump the version for every release. The updater compares versions, so a release with the same version number is ignored.
