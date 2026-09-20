# Privacy Policy for YTMusic Counter

Last updated: September 2026

**YTMusic Counter** is built with a strict privacy-first architecture. This extension exists solely to give you personal insights into your YouTube Music listening habits without collecting, tracking, or transmitting any of your data.

---

## 🔒 Summary of Privacy Guarantees

* **Zero Personal Data Collection**: We do not collect names, email addresses, IP addresses, browsing histories, or any identifiable information.
* **Zero External Network Transmission**: The extension makes **no** network requests to external servers, analytics services, telemetry platforms, or third parties.
* **100% On-Device Storage**: All play counts, album completion counters, and custom settings are stored strictly in your browser's local sandbox storage (`browser.storage.local`).
* **No Monetization or Selling of Data**: Your listening statistics are yours alone. No data is ever sold, leased, or shared.

---

## 🔑 Permissions and Why They Are Needed

The extension requests the minimum set of permissions necessary to function:

| Permission | Purpose |
| :--- | :--- |
| `storage` | Saves your local song, artist, and album play counts directly in your browser (`browser.storage.local`). |
| `activeTab` | Allows the extension popup to check if YouTube Music is currently focused. |
| `tabs` | Enables the extension to open or switch to `music.youtube.com` when clicking extension shortcuts. |
| `*://music.youtube.com/*` (Host) | Injects the content script onto YouTube Music to detect track playback and render the in-player play count badge. |

---

## 💾 How Data is Stored and Deleted

* **Storage Location**: All metrics (play counts, grouped counters, and history sync states) reside in your browser's private local storage partition.
* **User Control & Deletion**:
  * You can clear all recorded statistics at any time through the extension's **Details & Configuration** page using the **Wipe All Stored Data** button.
  * Uninstalling or removing the extension from your browser instantly and permanently erases all associated data stored by the extension.

---

## ⚖️ Third-Party Services & YouTube

YTMusic Counter runs locally on `music.youtube.com` within your existing browser session. It does not send your YouTube account details, credentials, cookies, or playback information to any external service or API.

---

## 📬 Contact & Open Source Verification

YTMusic Counter is fully open-source. Anyone can inspect, audit, or verify the source code:
* GitHub Repository: [https://github.com/r4pture-Maik/ytmusic-counter](https://github.com/r4pture-Maik/ytmusic-counter)
* For questions or issues, please open an issue on GitHub.
