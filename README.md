# YTMusic Counter - Firefox Extension

A lightweight, privacy-friendly Firefox WebExtension (Manifest V3) that tracks and counts your music listening stats on [YouTube Music](https://music.youtube.com).

---

## 🎯 Key Features

1. **Per-Song Player Badge**: Directly on YouTube Music's player bar, you see how many times you have listened to the currently playing song (e.g. `🎵 5 plays`).
2. **Aggregated Grouped Counters**:
   - **Songs**: Lifetime play count per unique track.
   - **Artists**: Lifetime plays aggregated across all songs by that artist (including collaborations).
   - **Albums**: Counts how many times you have listened to a full album **from start to finish** without skipping.
3. **Optimized Storage**: Uses compact $O(1)$ dictionary key-value maps. Zero bloat, no unbounded chronological histories, and negligible memory footprint (< 400 KB even after years of continuous listening).
4. **No Build Step Required**: Pure WebExtensions (Manifest V3) JavaScript, CSS, and HTML.
5. **Full Details Page & Config**: Dedicated tab view with a "Totals Song Listened" hero row and a Config tab featuring a safe 3-step confirmation data wipe.
6. **Automated History Scanner**: Scans `music.youtube.com/history` with auto-scrolling to extract past listening history and batch-import all tracks, plays, and artists into your extension stats.

---

## 📁 Project Structure

```text
ytmusic-counter/
├── manifest.json              # WebExtension Manifest V3 metadata & permissions
├── background/
│   └── background.js          # Background service managing grouped counters in storage
├── content/
│   ├── content.js             # Injected script detecting playback, albums & song badge
│   └── content.css            # Styling for the per-song badge on YouTube Music's player
├── details/
│   ├── details.html           # Full details page with statistics & config tabs
│   ├── details.css            # Responsive dark mode styling for the details dashboard
│   └── details.js             # Tab switcher, stats sync & 3-step confirmation data wipe
├── popup/
│   ├── popup.html             # Extension popup with tabs for Songs, Artists, and Albums
│   ├── popup.css              # Dark theme styling (YouTube Music aesthetic)
│   └── popup.js               # Tab logic, real-time counters & storage sync
├── icons/
│   └── icon.svg               # Extension vector icon
└── README.md                  # Documentation & setup guide
```

---

## 🚀 How to Install and Test in Firefox

### 1. Open Firefox Debugging Page
In Firefox, enter the following URL in the address bar:
```text
about:debugging#/runtime/this-firefox
```

### 2. Load the Extension
1. Under **Temporary Extensions**, click **"Load Temporary Add-on..."**.
2. Browse to the extension folder:
   ```text
   path/to/ytmusic-counter
   ```
3. Select `manifest.json` and click **Open**.

---

## 🎧 Testing the Features

1. Open **[https://music.youtube.com](https://music.youtube.com)**.
2. Play any song:
   - Notice the player badge next to the volume controls immediately shows: `🎵 0 plays` (or previous count).
   - After listening for at least 5 seconds, the count increments by 1 with a subtle pulse animation.
3. Click the **YTMusic Counter** icon in your Firefox toolbar:
   - View your **Total Plays**, **Unique Songs**, **Unique Artists**, and **Full Albums** completed.
   - Switch between the **Top Songs**, **Artists**, and **Full Albums** tabs.
   - Check the **Now Playing** card displaying the active song's play count.

---

## 🔒 Privacy & Data Collection

**YTMusic Counter is privacy-friendly by architecture:**

- **No telemetry, no analytics, no tracking**: nothing is measured, logged, fingerprinted, or sent anywhere.
- **No data leaves your browser**: there is no server, no account, no backend. The only network requests go to `music.youtube.com` (to read your listening history and look up album tracklists) and to Google's own image CDNs (to download cover art) — the same hosts YouTube Music already contacts while you use it.
- **100% on-device storage**: all counts live in `storage.local` plus a local IndexedDB cover-art cache. Uninstalling erases everything.
- **Open source and auditable**: no build step, no obfuscation, no vendored binaries. The code you review is the code that runs.
- **History import is opt-in**: the only feature that reads anything about your activity runs when you ask it to, and is documented in full in the [Privacy Policy](PRIVACY.md).

Read the complete [Privacy Policy](PRIVACY.md) for network request details, permission
explanations, and the Chrome Web Store Limited Use affirmation.

---

## ⚖️ Disclaimer & Trademark Notice

YouTube and YouTube Music are registered trademarks of Google LLC. 

**YTMusic Counter** is an independent, open-source project and is not affiliated with, endorsed by, sponsored by, or connected to Google LLC, YouTube, or Alphabet Inc.

---

## 📦 Building for Release

There is no bundler and no transpiler. `tools/build.mjs` copies the served files and
drops the manifest keys each browser does not implement, producing two uploadable
archives in `dist/`:

```bash
npm run build           # both targets
npm run build:chrome    # -> dist/chrome-1.1.0.zip
npm run build:firefox   # -> dist/firefox-1.1.0.zip
```

Nothing is minified or concatenated, so the uploaded code is byte-identical to the
source above and both stores accept it without a separate source-code submission.
`dist/` is gitignored.

The single `manifest.json` is the source of truth for both. It carries both
`background.service_worker` (Chrome) and `background.scripts` (Firefox) because the two
browsers implement MV3 background contexts differently, and the build strips whichever
one the target does not want.

> `minimum_chrome_version` must stay at **121 or above** while `background.scripts` is
> present in the source manifest: Chrome 120 and earlier refuse to load the extension
> outright. The build fails loudly if that invariant is ever broken.

---

## 📄 License

This project is licensed under the **[MIT License](LICENSE)** - see the [LICENSE](LICENSE) file for details.

