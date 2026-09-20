# YTMusic Counter - Firefox Extension

A lightweight, privacy-friendly Firefox WebExtension (Manifest V3) that counts and tracks played tracks and listening sessions on [YouTube Music](https://music.youtube.com).

---

## 📁 Project Structure

```text
ytmusic-counter/
├── manifest.json              # WebExtension Manifest V3 metadata & permissions
├── background/
│   └── background.js          # Background service managing counts & persistent storage
├── content/
│   ├── content.js             # Injected script detecting playback on music.youtube.com
│   └── content.css            # Styling for the subtle on-page counter badge
├── popup/
│   ├── popup.html             # Sleek dark-mode extension popup
│   ├── popup.css              # Popup styling (YouTube Music dark aesthetic)
│   └── popup.js               # Popup interactivity & real-time counter updates
├── icons/
│   └── icon.svg               # Extension icon (SVG, supported natively by Firefox)
└── README.md                  # Documentation & setup guide
```

---

## 🚀 How to Install and Test in Firefox

Because this extension uses pure Vanilla WebExtensions standards, no build step or package manager is required. You can load it directly into Firefox:

### 1. Open Firefox Debugging Page
1. Open Firefox and enter the following URL in the address bar:
   ```text
   about:debugging#/runtime/this-firefox
   ```
2. Press **Enter**.

### 2. Load the Extension
1. Under **Temporary Extensions**, click the button:
   > **"Load Temporary Add-on..."**
2. Browse to this project folder:
   ```text
   path/to/ytmusic-counter
   ```
3. Select `manifest.json` and click **Open**.

The extension **YTMusic Counter** will now appear in your Firefox toolbar!

---

## 🎧 How to Test

1. Navigate to **[https://music.youtube.com](https://music.youtube.com)**.
2. Start playing any song or playlist.
3. Observe:
   - The subtle counter badge will appear on YouTube Music's player bar showing your total plays count.
   - Click the **YTMusic Counter** icon in your Firefox toolbar to view:
     - Total tracks counted.
     - Live "Now Playing" track title and artist.
     - History of recent songs.
     - Reset button to clear statistics at any time.

---

## ⚙️ Key Technical Features

- **Manifest V3 Compliant**: Built to modern WebExtensions MV3 standards with Firefox Gecko compatibility.
- **Zero Build Dependencies**: Pure JavaScript, HTML5, and CSS3 without requiring Node.js or bundlers.
- **Debounced Playback Detection**: Songs are counted after playing for at least 5 seconds to prevent accidental counts during rapid track skipping.
- **Storage Persistence**: Uses `browser.storage.local` to safely persist song counts and history across browser sessions.
- **Dark Mode UI**: Designed to match the look and feel of YouTube Music with glowing red accents and clean metrics.
