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
