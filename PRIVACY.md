# Privacy Policy for YTMusic Counter

> **Date:** 2026-09-26

Last updated: September 2026

**YTMusic Counter** is built on a privacy-first architecture. It exists to give you personal insight into your own YouTube Music listening habits, and for no other purpose. There is no server component, no account, and no backend. Nobody — including the author — can see your data.

---

## 🔒 Summary of Privacy Guarantees

* **No Data Collection**: The extension has no mechanism to collect your name, email address, IP address, browsing history, or any other identifying information. We do not operate servers and have no way to receive data.
* **No Analytics, Telemetry, or Tracking**: There is no analytics SDK, no telemetry endpoint, no crash reporting, no A/B testing, and no fingerprinting anywhere in the codebase.
* **On-Device Storage Only**: All play counts, album completions, listening durations, cached cover art, and settings stay in your browser's local storage (`browser.storage.local`) and a local IndexedDB database. They are never uploaded anywhere.
* **No Third-Party Services**: The extension communicates only with `music.youtube.com` and Google's own image CDNs. It has no integrations with analytics providers, advertisers, social networks, or any other external company.
* **No Data Monetization**: Your listening statistics belong to you alone. Nothing is sold, licensed, rented, or shared.

---

## 🌐 Network Requests & Third-Party Access

The extension is not fully offline, because reading your play history and loading album artwork requires talking to YouTube Music. Every request it makes is listed here — there are no others.

| Destination | Purpose | What is sent |
| :--- | :--- | :--- |
| `music.youtube.com` | Read your listening history, look up album tracklists, and search for album metadata. | Standard request data, using your existing signed-in session. No credentials are read, stored, or forwarded by the extension. |
| `lh3.googleusercontent.com`, `ggpht.com`, `ytimg.com` | Download album cover images so they can be displayed and cached locally. | A plain image request for artwork. |

**What this means in practice:**

* These are the same hosts YouTube Music itself already contacts while you are using it. Requesting an album page or cover image is indistinguishable from clicking around the site normally.
* The extension never receives, reads, stores, or transmits your Google account credentials, cookies, or session tokens.
* No request is ever sent to a server operated by the author. The GitHub repository is where the source code lives; it is not a data endpoint.
* Album artwork requests reveal only that a given cover image was requested. They carry no play counts, no listening history, and no identifiers belonging to you.

If you would prefer the extension make no network requests at all, you can block `music.youtube.com` in your browser's extension settings. Historical tracking will stop working, but nothing else changes.

---

## 🔑 Permissions and Why They Are Needed

| Permission | Purpose |
| :--- | :--- |
| `storage` | Saves your song, artist, and album play counts, plus your settings, in your browser's local storage. |
| `tabs` | Used only to find, open, or focus `music.youtube.com` tabs. This is how the popup knows whether YouTube Music is running, and how the history scanner reuses a tab you already have open instead of opening a new one. It is never used to read the contents of any other tab. |
| `*://music.youtube.com/*` (Host) | Injects the content script that detects track playback and renders the in-player play count badge. It is also what allows the extension to read your YouTube Music listening history — see [History Import](#-history-import-what-we-read-from-youtube-music) below. |
| `*.googleusercontent.com`, `*.ggpht.com`, `*.ytimg.com` (Host) | Allows album cover images to be downloaded from Google's image CDNs and cached locally. |

No permission is requested for your downloads, clipboard, camera, microphone,
geolocation, or cookies. In particular the extension does **not** request Chrome's
`history`, `browsingData`, or `webNavigation` permissions, and it never touches
browsing history from outside YouTube Music.

It does read your **YouTube Music listening history**, but not through a browser
permission: it asks YouTube Music itself, over your existing signed-in session,
and only to build the statistics this extension exists to show. That is the most
sensitive thing it does, so it is documented in full in the next section.

---

## 📜 History Import: What We Read From YouTube Music

This section is here because the history import is the only part of this extension
that reads anything about your activity, and you should be able to see exactly what
it touches before you install it.

**What it does.** The *History Scanner* can open `music.youtube.com/history`, scroll
it, and read the entries YouTube Music already shows you in that page. Each entry
gives a song, an artist, and an album. Those are counted into your local statistics.

**What it reads.** Only what the history page itself displays: song, artist, album,
and how many times you played them. Nothing else is extracted from the page.

**What it does not do.**

* It does not read, store, or transmit your account email, name, or profile.
* It does not read or forward cookies, session tokens, or credentials.
* It does not read Chrome's browsing history — only the YouTube Music page.
* It does not read any other site's history, and it runs on no other site.
* It does not modify, delete, or write anything back to your YouTube account. The
  history page is only ever read.
* It never reaches a server operated by the author.

**Where the result goes.** Straight into your browser's local storage, alongside
the counts it derives from ordinary playback. You can erase everything with
**Wipe All Stored Data** in the Details & Configuration page, at any time, without
opening the scanner.

**If you would rather it did not.** The scanner only runs when you ask it to, from
the Details & Configuration page. Uninstalling, or wiping your data, stops it
permanently. If you never press the button, your existing history is never read.


---

## 💾 How Data is Stored, and How to Delete It

* **Storage Locations**: All metrics reside in your browser's private local storage partition and a local IndexedDB database used for the cover-art cache. Neither is accessible to other extensions or websites.
* **Export**: You can download a complete copy of your library as a JSON file at any time. That file is generated locally and saved directly to your device. It is never transmitted.
* **You Are in Control**:
  * Clear the cover-art cache at any time from the **Details & Configuration** page.
  * Erase all recorded statistics at any time using the **Wipe All Stored Data** button on the same page.
  * Uninstalling the extension permanently and immediately erases everything it stored.

---

## ⚖️ YouTube and Google

YTMusic Counter runs alongside `music.youtube.com` inside your existing browser session. It does not send your YouTube account details, credentials, cookies, or playback information to any external service.

YouTube Music and Google collect data under their own privacy policies, independently of this extension. This document describes only what the extension itself does. If you have questions about how Google handles your data, please refer to [Google's Privacy Policy](https://policies.google.com/privacy).

---

## 🔒 Chrome Web Store Limited Use

This extension is published on the Chrome Web Store, so it is bound by the Store's
Limited Use requirements. The required affirmation:

> The use of information received from Google APIs will adhere to the Chrome Web
> Store User Data Policy, including the Limited Use requirements.

Concretely, that means:

* **Single purpose.** The data is used only to count listening activity and show you
  those counts. It is not used for advertising, profiling, credit decisions, or any
  other purpose.
* **No third parties.** Data is never transferred to anyone — not advertisers, not
  data brokers, not analytics providers. There is no third party to transfer it to.
* **No human access.** Not the author, not Google, not anyone else. Your data has no
  reader, because it never leaves your device.
* **No browsing activity.** The extension does not collect web browsing activity. The
  only page it reads is YouTube Music, and only to serve the feature described in
  [History Import](#-history-import-what-we-read-from-youtube-music).
* **Deletion on request.** Wiping your data in the extension, or uninstalling it,
  removes every trace of it.


---

## 📬 Open Source Verification

YTMusic Counter is fully open source. Anyone can inspect, audit, or verify these claims by reading the source code — there is no closed-source binary, no obfuscated code, and no build step that hides logic from review.

* Source code: [https://github.com/r4pture-Maik/ytmusic-counter](https://github.com/r4pture-Maik/ytmusic-counter)
* Issues and questions: [https://github.com/r4pture-Maik/ytmusic-counter/issues](https://github.com/r4pture-Maik/ytmusic-counter/issues)

If you believe this policy is inaccurate or that the extension is doing something it should not, please open an issue. Verified reports are treated as bugs and fixed.
