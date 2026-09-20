/**
 * YTMusic Counter - Content Script
 * Tracks song plays, updates per-song counter badge in the player bar,
 * and detects start-to-finish album playback.
 */

(function () {
  const extBrowser = typeof browser !== 'undefined' ? browser : chrome;

  let lastTrackKey = null;
  let currentSongPlays = 0;
  let trackPlaybackTimer = null;
  const MIN_PLAY_TIME_MS = 5000; // Minimum active listening duration

  // Album start-to-finish session tracker
  let currentAlbumSession = null;

  console.log('[YTMusic Counter] Content script initialized.');

  /**
   * Extracts metadata of the currently playing song from the DOM
   */
  function getCurrentTrackInfo() {
    const titleElem = document.querySelector('ytmusic-player-bar .title');
    const bylineElem = document.querySelector('ytmusic-player-bar .byline');

    if (!titleElem) {
      if (navigator.mediaSession && navigator.mediaSession.metadata) {
        const meta = navigator.mediaSession.metadata;
        return {
          title: meta.title || '',
          artist: meta.artist || '',
          album: meta.album || ''
        };
      }
      return null;
    }

    const title = titleElem.textContent ? titleElem.textContent.trim() : '';
    let artist = '';
    let album = '';
    let albumBrowseId = '';
    let isSingle = false;

    if (bylineElem) {
      const bylineText = bylineElem.textContent || '';
      if (/\bsingle\b/i.test(bylineText)) {
        isSingle = true;
      }

      const links = Array.from(bylineElem.querySelectorAll('a'));
      if (links.length > 0) artist = links[0].textContent.trim();
      if (links.length > 1) {
        const linkText = links[1].textContent.trim();
        if (/^single(\s*-\s*ep)?$/i.test(linkText) || /^ep$/i.test(linkText)) {
          isSingle = true;
        } else {
          album = linkText;
          const href = links[1].getAttribute('href') || '';
          const match = href.match(/(MPREb[a-zA-Z0-9_-]+|OLAK5uy[a-zA-Z0-9_-]+)/);
          if (match) albumBrowseId = match[1];
        }
      }

      // Fallback parse by bullets
      if (!artist && bylineText) {
        const parts = bylineText.split('•').map(p => p.trim()).filter(Boolean);
        const textParts = parts.filter(p => 
          !/^\d+:\d+(:\d+)?$/.test(p) && 
          !/^\d{4}$/.test(p) &&
          !/^single(\s*-\s*ep)?$/i.test(p)
        );
        if (textParts[0]) artist = textParts[0];
        if (!album && !isSingle && textParts[1]) album = textParts[1];
      }

      if (album && (/^single(\s*-\s*ep)?$/i.test(album) || /^ep$/i.test(album))) {
        isSingle = true;
        album = '';
      }
    }

    return { title, artist, album, albumBrowseId, isSingle };
  }

  /**
   * Checks if audio is currently actively playing
   */
  function isPlaying() {
    const playPauseBtn = document.querySelector('#play-pause-button');
    if (playPauseBtn) {
      const ariaLabel = playPauseBtn.getAttribute('aria-label') || '';
      const title = playPauseBtn.getAttribute('title') || '';
      if (/pause/i.test(ariaLabel) || /pause/i.test(title)) {
        return true;
      }
    }
    const video = document.querySelector('video');
    if (video && !video.paused && !video.ended) {
      return true;
    }
    return false;
  }

  /**
   * Finds the active queue index and total queue count
   */
  function getQueueStatus() {
    const queueItems = document.querySelectorAll('ytmusic-player-queue-item');
    if (!queueItems || queueItems.length === 0) return null;

    let selectedIndex = -1;
    queueItems.forEach((item, index) => {
      if (item.hasAttribute('selected') || item.classList.contains('selected')) {
        selectedIndex = index;
      }
    });

    return {
      total: queueItems.length,
      currentIndex: selectedIndex
    };
  }

  /**
   * Updates or checks the album start-to-finish tracker
   */
  function updateAlbumTracker(track) {
    if (!track.album) {
      currentAlbumSession = null;
      return;
    }

    const queue = getQueueStatus();
    if (!queue || queue.total <= 1) return;

    // Check if URL or context indicates an album (e.g. OLAK5uy_ playlist)
    const isAlbumContext = window.location.href.includes('OLAK5uy') || 
                           window.location.href.includes('browse/MPREb') ||
                           Boolean(track.album);

    if (!isAlbumContext) return;

    // If on track 0 (first track of album), start new session
    if (queue.currentIndex === 0) {
      currentAlbumSession = {
        album: track.album,
        artist: track.artist,
        totalTracks: queue.total,
        playedIndices: new Set([0])
      };
      console.log(`[YTMusic Counter] Started album session for "${track.album}" (${queue.total} tracks)`);
      return;
    }

    // If an album session is active, verify continuous playback
    if (currentAlbumSession) {
      if (currentAlbumSession.album.toLowerCase() === track.album.toLowerCase()) {
        if (queue.currentIndex >= 0) {
          currentAlbumSession.playedIndices.add(queue.currentIndex);
        }

        // Check if all tracks in the album queue were played
        if (currentAlbumSession.playedIndices.size >= currentAlbumSession.totalTracks) {
          console.log(`[YTMusic Counter] Full album completed: "${currentAlbumSession.album}"!`);
          extBrowser.runtime.sendMessage({
            type: 'ALBUM_COMPLETED',
            payload: {
              album: currentAlbumSession.album,
              artist: currentAlbumSession.artist
            }
          });
          currentAlbumSession = null; // Session finished
        }
      } else {
        // Switched to a different album/source, cancel album session
        currentAlbumSession = null;
      }
    }
  }

  /**
   * Main observer callback whenever player bar updates
   */
  function checkTrackChange() {
    const track = getCurrentTrackInfo();
    if (!track || !track.title) return;

    const currentKey = `${track.title}:::${track.artist}`;

    if (currentKey !== lastTrackKey) {
      lastTrackKey = currentKey;

      if (trackPlaybackTimer) {
        clearTimeout(trackPlaybackTimer);
        trackPlaybackTimer = null;
      }

      // Step 1: Immediately fetch existing play count for THIS song and update badge
      extBrowser.runtime.sendMessage({
        type: 'GET_SONG_COUNT',
        payload: track
      }, (res) => {
        if (res && res.status === 'ok') {
          currentSongPlays = res.data.songPlays || 0;
          updateSongBadge(currentSongPlays, false);
        }
      });

      // Step 2: Set threshold timer (5 seconds of active playback)
      trackPlaybackTimer = setTimeout(() => {
        if (lastTrackKey === currentKey && isPlaying()) {
          countSongPlay(track);
          updateAlbumTracker(track);
        }
      }, MIN_PLAY_TIME_MS);
    }
  }

  /**
   * Sends play notification to background script and updates UI
   */
  function countSongPlay(track) {
    try {
      extBrowser.runtime.sendMessage({
        type: 'TRACK_PLAYED',
        payload: track
      }, (response) => {
        if (response && response.status === 'ok') {
          currentSongPlays = response.data.songPlays;
          console.log(`[YTMusic Counter] "${track.title}" play registered! Total plays for this song: ${currentSongPlays}`);
          updateSongBadge(currentSongPlays, true);
        }
      });
    } catch (err) {
      console.warn('[YTMusic Counter] Messaging error:', err);
    }
  }

  /**
   * Updates the on-player badge with the play count for the current song
   */
  function updateSongBadge(count, animate) {
    let badge = document.getElementById('ytmusic-counter-badge');
    if (!badge) {
      const rightControls = document.querySelector('ytmusic-player-bar .right-controls-buttons');
      if (!rightControls) return;

      badge = document.createElement('div');
      badge.id = 'ytmusic-counter-badge';
      rightControls.prepend(badge);
    }

    const label = count === 1 ? 'play' : 'plays';
    badge.title = `You have listened to this song ${count} ${label}`;
    badge.innerHTML = `<span class="ytmc-icon">🎵</span> <span class="ytmc-count ${animate ? 'pulse' : ''}">${count}</span> <span class="ytmc-label">${label}</span>`;
  }

  /* ==========================================================================
     YouTube Music History Scanner Module (Date-Sectional Offset)
     ========================================================================== */
  let isScanning = false;
  let scanInterval = null;
  let scannedTracks = [];
  let idleScrollCount = 0;
  let activeSyncState = null;
  let topSectionDate = null;
  let topSectionCount = 0;

  const MAX_HISTORY_SCAN_ITEMS = 200;

  function isHistoryPage() {
    const path = window.location.pathname || '';
    return path === '/history' || path.startsWith('/history');
  }

  function parseTrackFromItem(item) {
    if (!item) return null;

    // 1. Extract Title
    const titleElem = item.querySelector(
      '.title-column yt-formatted-string, .title a, .title yt-formatted-string, yt-formatted-string.title, [is-empty="false"].title'
    ) || item.querySelector('.title');
    const title = titleElem ? titleElem.textContent.trim() : '';
    if (!title) return null;

    let artist = '';
    let album = '';
    let albumBrowseId = '';
    let isSingle = false;

    // Check if the item text directly mentions Single
    const itemText = item.textContent || '';
    if (/\bsingle\b/i.test(itemText)) {
      isSingle = true;
    }

    // 2. Extract Artist & Album via specific YouTube Music anchor links
    // Artist links typically contain "/channel/" or "/browse/UC" or "/browse/FEmusic_library"
    const artistLinks = Array.from(item.querySelectorAll('.secondary-flex-columns a, .flex-columns a, a')).filter(a => {
      const href = a.getAttribute('href') || '';
      return href.includes('/channel/') || href.includes('/browse/UC') || href.includes('browse/FEmusic_library');
    });

    if (artistLinks.length > 0) {
      artist = artistLinks.map(a => a.textContent.trim()).filter(Boolean).join(', ');
    }

    // Album links typically contain "browse/MPREb" or "browse/OLAK5uy" or "playlist?list=OLAK5uy"
    const albumLinks = Array.from(item.querySelectorAll('.secondary-flex-columns a, .flex-columns a, a')).filter(a => {
      const href = a.getAttribute('href') || '';
      return href.includes('browse/MPREb') || href.includes('browse/OLAK5uy') || 
             href.includes('playlist?list=OLAK5uy') || href.includes('playlist?list=MPREb');
    });

    if (albumLinks.length > 0) {
      const linkText = albumLinks[0].textContent.trim();
      if (/^single(\s*-\s*ep)?$/i.test(linkText) || /^ep$/i.test(linkText)) {
        isSingle = true;
      } else {
        album = linkText;
        const href = albumLinks[0].getAttribute('href') || '';
        const match = href.match(/(MPREb[a-zA-Z0-9_-]+|OLAK5uy[a-zA-Z0-9_-]+)/);
        if (match) albumBrowseId = match[1];
      }
    }

    // 3. Fallback: Parse secondary flex columns / formatted strings
    const secCols = Array.from(item.querySelectorAll('.secondary-flex-columns, yt-formatted-string.subtitle, .subtitle, .byline'));

    if (!artist || !album) {
      if (secCols.length >= 2) {
        // Desktop multi-column layout (col 0 = artist, col 1 = album)
        if (!artist && secCols[0]) {
          artist = secCols[0].textContent.trim();
        }
        if (!album && !isSingle && secCols[1]) {
          const colText = secCols[1].textContent.trim();
          if (/^single(\s*-\s*ep)?$/i.test(colText) || /^ep$/i.test(colText)) {
            isSingle = true;
          } else if (!/^\d+:\d+(:\d+)?$/.test(colText) && !/^\d{4}$/.test(colText) && !/views?|plays?|listening/i.test(colText)) {
            album = colText;
          }
        }
      } else if (secCols.length === 1 && secCols[0].textContent) {
        // Single column with bullets (e.g. "Artist • Album • 3:45" or "Artist • Single • 2024")
        const parts = secCols[0].textContent.split('•').map(p => p.trim()).filter(Boolean);
        parts.forEach(p => {
          if (/^single(\s*-\s*ep)?$/i.test(p) || /^ep$/i.test(p)) isSingle = true;
        });

        const textParts = parts.filter(p => 
          !/^\d+:\d+(:\d+)?$/.test(p) && 
          !/^\d{4}$/.test(p) &&
          !/^\d+(\.\d+)?[KM]?\s*(plays?|views?)/i.test(p) &&
          !/^single(\s*-\s*ep)?$/i.test(p) &&
          !/^ep$/i.test(p)
        );

        if (!artist && textParts.length > 0) {
          artist = textParts[0];
        }
        if (!album && !isSingle && textParts.length > 1) {
          album = textParts[1];
        }
      }
    }

    // 4. Fallback: Check any formatted string in item if artist is still missing
    if (!artist) {
      const allFormatted = Array.from(item.querySelectorAll('yt-formatted-string')).filter(el => el !== titleElem);
      if (allFormatted.length > 0) {
        const firstText = allFormatted[0].textContent.trim();
        if (firstText && !/^\d+:\d+$/.test(firstText)) {
          const parts = firstText.split('•').map(p => p.trim()).filter(Boolean);
          if (parts[0]) artist = parts[0];
          if (!album && !isSingle && parts[1] && !/^\d+:\d+$/.test(parts[1]) && !/^single/i.test(parts[1])) {
            album = parts[1];
          }
        }
      }
    }

    // 5. Clean up album name: discard if it's duration, pure year, view count, or "single"
    if (album) {
      if (/^\d+:\d+(:\d+)?$/.test(album) || 
          /^\d{4}$/.test(album) || 
          /^\d+(\.\d+)?[KM]?\s*(plays?|views?)/i.test(album) ||
          /^single(\s*-\s*ep)?$/i.test(album) ||
          /^ep$/i.test(album)) {
        if (/^single/i.test(album)) isSingle = true;
        album = '';
      }
    }

    return {
      title,
      artist: artist || 'Unknown Artist',
      album: album || '',
      albumBrowseId: albumBrowseId || '',
      isSingle: Boolean(isSingle)
    };
  }

  function injectHistoryScannerOverlay() {
    if (document.getElementById('ytmc-history-scanner-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'ytmc-history-scanner-overlay';
    overlay.innerHTML = `
      <div class="ytmc-scanner-header">
        <div class="ytmc-scanner-title-group">
          <div class="ytmc-scanner-logo">
            <svg viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/>
              <polygon points="10,8 16,12 10,16" fill="currentColor"/>
            </svg>
          </div>
          <span class="ytmc-scanner-title">YTMusic History Scanner</span>
        </div>
        <div class="ytmc-scanner-controls">
          <button type="button" class="ytmc-btn-mini" id="ytmc-minimize-btn" title="Minimize">—</button>
          <button type="button" class="ytmc-btn-mini" id="ytmc-close-btn" title="Close">✕</button>
        </div>
      </div>
      <div class="ytmc-scanner-body">
        <div class="ytmc-scanner-metrics">
          <div class="ytmc-metric-card">
            <span class="ytmc-metric-label">Plays Detected</span>
            <span class="ytmc-metric-val" id="ytmc-scan-count">0</span>
          </div>
          <div class="ytmc-metric-card">
            <span class="ytmc-metric-label">Unique Songs</span>
            <span class="ytmc-metric-val" id="ytmc-scan-unique">0</span>
          </div>
        </div>
        <div class="ytmc-scanner-status-box">
          <div class="ytmc-status-spinner" id="ytmc-scan-spinner"></div>
          <span id="ytmc-scan-note">Ready to scan your YouTube Music listening history.</span>
        </div>
        <div style="font-size: 11px; color: #888; display: flex; align-items: center; gap: 6px;">
          <input type="checkbox" id="ytmc-force-rescan-cb">
          <label for="ytmc-force-rescan-cb" style="cursor: pointer;">Force full rescan (ignore date offset)</label>
        </div>
        <div class="ytmc-scanner-actions">
          <button type="button" class="ytmc-btn-scan-start" id="ytmc-start-scan-btn">
            <span>▶ Start Auto-Scan</span>
          </button>
          <button type="button" class="ytmc-btn-scan-stop" id="ytmc-stop-scan-btn" disabled>
            <span>⏹ Stop &amp; Save</span>
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const startBtn = overlay.querySelector('#ytmc-start-scan-btn');
    const stopBtn = overlay.querySelector('#ytmc-stop-scan-btn');
    const minimizeBtn = overlay.querySelector('#ytmc-minimize-btn');
    const closeBtn = overlay.querySelector('#ytmc-close-btn');

    startBtn.addEventListener('click', () => {
      const force = Boolean(overlay.querySelector('#ytmc-force-rescan-cb')?.checked);
      startHistoryScan(force);
    });
    stopBtn.addEventListener('click', () => stopAndSaveHistory(false));
    minimizeBtn.addEventListener('click', () => {
      overlay.classList.toggle('ytmc-minimized');
      minimizeBtn.textContent = overlay.classList.contains('ytmc-minimized') ? '◻' : '—';
    });
    closeBtn.addEventListener('click', () => {
      if (isScanning) stopAndSaveHistory(false);
      overlay.remove();
    });

    if (window.location.search.includes('autostart=1')) {
      const force = window.location.search.includes('forceRescan=1');
      setTimeout(() => startHistoryScan(force), 1200);
    }
  }

  async function startHistoryScan(forceRescan = false) {
    if (isScanning) return;
    isScanning = true;
    idleScrollCount = 0;
    scannedTracks = [];
    topSectionDate = null;
    topSectionCount = 0;

    const isForce = forceRescan || window.location.search.includes('forceRescan=1');
    if (!isForce) {
      try {
        const syncData = await extBrowser.storage.local.get(['historySyncState']);
        activeSyncState = (syncData && syncData.historySyncState) || null;
      } catch (_) {
        activeSyncState = null;
      }
    } else {
      activeSyncState = null;
    }

    console.log('[YTMC Content] Starting scan. Force rescan:', isForce, 'Active sync state:', activeSyncState);

    const startBtn = document.getElementById('ytmc-start-scan-btn');
    const stopBtn = document.getElementById('ytmc-stop-scan-btn');
    const spinner = document.getElementById('ytmc-scan-spinner');
    const note = document.getElementById('ytmc-scan-note');

    if (startBtn) startBtn.disabled = true;
    if (stopBtn) stopBtn.disabled = false;
    if (spinner) spinner.style.display = 'block';
    if (note) {
      note.textContent = activeSyncState
        ? `Incremental scan active (checking since "${activeSyncState.lastDateHeader}")...`
        : 'Scanning and extracting history items...';
    }

    // Broadcast starting state
    extBrowser.storage.local.set({
      scanProgress: {
        isScanning: true,
        count: 0,
        unique: 0,
        latestTrack: null,
        statusText: activeSyncState ? 'Incremental scan active...' : 'Auto-scrolling history...'
      }
    });

    scanInterval = setInterval(() => {
      let newlyFound = 0;
      let latestExtracted = null;
      let reachedBoundary = false;

      // Section-aware extraction (handles looping identical songs or multiple identical plays)
      const sections = document.querySelectorAll('ytmusic-item-section-renderer, ytmusic-shelf-renderer');

      if (sections.length > 0) {
        // Record the top section's date and its current item count in DOM
        const firstSection = sections[0];
        const firstHeader = firstSection.querySelector('#header yt-formatted-string, .header yt-formatted-string, #title, h2');
        topSectionDate = firstHeader ? firstHeader.textContent.trim() : 'Today';
        const firstItems = firstSection.querySelectorAll('ytmusic-responsive-list-item-renderer');
        topSectionCount = firstItems.length;

        for (const section of sections) {
          const header = section.querySelector('#header yt-formatted-string, .header yt-formatted-string, #title, h2');
          const sectionDate = (header ? header.textContent.trim() : '').toLowerCase();
          const items = Array.from(section.querySelectorAll('ytmusic-responsive-list-item-renderer'));

          // Check if this section matches the previously synced date
          if (activeSyncState && activeSyncState.lastDateHeader && sectionDate === activeSyncState.lastDateHeader.toLowerCase()) {
            const M = items.length;
            const K = activeSyncState.syncedCountOnDate || 0;
            const delta = M - K;

            console.log(`[YTMC Offset] Matched sync date "${activeSyncState.lastDateHeader}": M=${M}, K=${K}, delta=${delta}`);

            if (delta > 0) {
              // Take only the newest 'delta' items from the top of this section
              for (let i = 0; i < delta; i++) {
                const item = items[i];
                if (item.dataset.ytmcProcessed) continue;
                item.dataset.ytmcProcessed = 'true';
                const track = parseTrackFromItem(item);
                if (track) {
                  scannedTracks.push(track);
                  latestExtracted = track;
                  newlyFound++;
                }
              }
            }

            // Boundary reached! Halting scan immediately.
            reachedBoundary = true;
            break;
          } else {
            // Unmatched / Newer section: process all items
            items.forEach(item => {
              if (item.dataset.ytmcProcessed) return;
              item.dataset.ytmcProcessed = 'true';
              const track = parseTrackFromItem(item);
              if (track) {
                scannedTracks.push(track);
                latestExtracted = track;
                newlyFound++;
              }
            });
          }
        }
      } else {
        // Flat list fallback if no section elements exist
        const items = document.querySelectorAll('ytmusic-responsive-list-item-renderer');
        items.forEach(item => {
          if (item.dataset.ytmcProcessed) return;
          item.dataset.ytmcProcessed = 'true';
          const track = parseTrackFromItem(item);
          if (track) {
            scannedTracks.push(track);
            latestExtracted = track;
            newlyFound++;
          }
        });
      }

      const uniqueSet = new Set(scannedTracks.map(t => `${t.title.toLowerCase()}:::${(t.artist || '').toLowerCase()}`));

      const countEl = document.getElementById('ytmc-scan-count');
      const uniqueEl = document.getElementById('ytmc-scan-unique');
      if (countEl) countEl.textContent = scannedTracks.length;
      if (uniqueEl) uniqueEl.textContent = uniqueSet.size;

      // Broadcast progress to storage so Config page and popup see it in real time
      extBrowser.storage.local.set({
        scanProgress: {
          isScanning: true,
          count: scannedTracks.length,
          unique: uniqueSet.size,
          latestTrack: latestExtracted || (scannedTracks.length > 0 ? scannedTracks[scannedTracks.length - 1] : null),
          statusText: reachedBoundary ? 'Reached sync boundary!' : 'Reading & importing plays...'
        }
      });

      // Cap at 200 items (YouTube Music history endpoint cap)
      if (scannedTracks.length >= MAX_HISTORY_SCAN_ITEMS) {
        console.log(`[YTMC Content] Reached ${MAX_HISTORY_SCAN_ITEMS}-song history cap. Stopping.`);
        stopAndSaveHistory(true, `Reached ${MAX_HISTORY_SCAN_ITEMS}-song limit`);
        return;
      }

      if (reachedBoundary) {
        console.log('[YTMC Offset] Date boundary reached! Stopping scan now.');
        stopAndSaveHistory(true, 'Boundary reached');
        return;
      }

      // Gentle, smooth scroll to load history without excessive jumping
      window.scrollBy({ top: 1000, behavior: 'smooth' });
      if (document.scrollingElement) document.scrollingElement.scrollTop += 1000;
      document.querySelectorAll('ytmusic-app, #browse-page, ytmusic-browse-response, #contents, #main-panel').forEach(el => {
        if (el.scrollHeight > el.clientHeight) el.scrollTop += 1000;
      });
      const allRendered = document.querySelectorAll('ytmusic-responsive-list-item-renderer');
      if (allRendered.length > 0) {
        try {
          allRendered[allRendered.length - 1].scrollIntoView({ behavior: 'smooth', block: 'end' });
        } catch (_) {}
      }

      console.log(`[YTMC Content] Scanned items. Newly found: ${newlyFound}, Total tracks: ${scannedTracks.length}, Unique: ${uniqueSet.size}`);

      if (newlyFound === 0) {
        idleScrollCount++;
        if (idleScrollCount >= 3) {
          console.log('[YTMC Content] No new items after 3 scroll attempts. Stopping.');
          stopAndSaveHistory(true, 'End of history reached');
          return;
        }
      } else {
        idleScrollCount = 0;
      }
    }, 750);
  }

  function stopAndSaveHistory(autoCompleted, reason = '') {
    if (!isScanning) return;
    isScanning = false;
    clearInterval(scanInterval);
    scanInterval = null;

    const startBtn = document.getElementById('ytmc-start-scan-btn');
    const stopBtn = document.getElementById('ytmc-stop-scan-btn');
    const spinner = document.getElementById('ytmc-scan-spinner');
    const note = document.getElementById('ytmc-scan-note');

    if (startBtn) startBtn.disabled = false;
    if (stopBtn) stopBtn.disabled = true;
    if (spinner) spinner.style.display = 'none';

    // Build new sync state baseline
    const newSyncState = {
      lastDateHeader: topSectionDate || (activeSyncState && activeSyncState.lastDateHeader) || 'Today',
      syncedCountOnDate: topSectionCount || (activeSyncState ? (activeSyncState.syncedCountOnDate + scannedTracks.length) : scannedTracks.length),
      lastSyncTimestamp: Date.now()
    };

    if (scannedTracks.length === 0) {
      const msg = activeSyncState ? 'No new plays detected since last scan (all up to date).' : 'No tracks found in history.';
      if (note) note.textContent = msg;
      extBrowser.storage.local.set({
        scanProgress: {
          isScanning: false,
          count: 0,
          unique: 0,
          latestTrack: null,
          statusText: msg
        },
        historySyncState: newSyncState
      });
      return;
    }

    if (note) note.textContent = `Saving ${scannedTracks.length} plays to extension storage...`;

    extBrowser.storage.local.set({
      scanProgress: {
        isScanning: true,
        count: scannedTracks.length,
        unique: new Set(scannedTracks.map(t => `${t.title.toLowerCase()}:::${(t.artist || '').toLowerCase()}`)).size,
        latestTrack: scannedTracks[scannedTracks.length - 1],
        statusText: `Saving ${scannedTracks.length} plays to storage...`
      }
    });

    extBrowser.runtime.sendMessage({
      type: 'IMPORT_HISTORY_TRACKS',
      payload: {
        tracks: scannedTracks,
        newSyncState
      }
    }, (response) => {
      const res = response && response.data;
      const importedCount = (res && res.importedCount) || scannedTracks.length;
      if (note) {
        note.innerHTML = `<b>Success!</b> Imported ${importedCount} new plays (${reason || 'Completed'}).`;
      }

      extBrowser.storage.local.set({
        scanProgress: {
          isScanning: false,
          count: importedCount,
          unique: (res && res.uniqueSongs) || 0,
          latestTrack: null,
          statusText: `Done! Imported ${importedCount} new plays (${reason || 'Completed'}).`
        },
        historySyncState: newSyncState
      });
    });
  }

  function checkHistoryRoute() {
    if (isHistoryPage()) {
      injectHistoryScannerOverlay();
    } else {
      if (isScanning) {
        stopAndSaveHistory(false, 'Navigated away from history');
      }
      const existing = document.getElementById('ytmc-history-scanner-overlay');
      if (existing) {
        existing.remove();
      }
    }
  }

  let lastCheckedHref = '';
  function handleRouteChange() {
    if (window.location.href !== lastCheckedHref) {
      lastCheckedHref = window.location.href;
      checkHistoryRoute();
    }
  }

  // Setup MutationObserver
  const observer = new MutationObserver(() => {
    checkTrackChange();
    handleRouteChange();
  });

  // Route and page change observers
  window.addEventListener('yt-navigate-start', handleRouteChange);
  window.addEventListener('yt-navigate-finish', handleRouteChange);
  window.addEventListener('yt-page-data-updated', handleRouteChange);
  window.addEventListener('popstate', handleRouteChange);
  window.addEventListener('hashchange', handleRouteChange);

  // Polling route check every 500ms for SPA navigations
  setInterval(handleRouteChange, 500);

  // Runtime message listener
  extBrowser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !message.type) return;

    if (message.type === 'PING_CONTENT_SCRIPT') {
      const items = document.querySelectorAll('ytmusic-responsive-list-item-renderer');
      console.log('[YTMC Content] Received PING_CONTENT_SCRIPT. URL:', window.location.href);
      sendResponse({
        status: 'ok',
        url: window.location.href,
        isHistory: isHistoryPage(),
        itemsCount: items.length,
        isScanning: isScanning,
        scannedCount: scannedTracks.length
      });
      return true;
    }

    if (message.type === 'START_HISTORY_SCAN') {
      const forceRescan = Boolean(message.forceRescan);
      console.log('[YTMC Content] Received START_HISTORY_SCAN. forceRescan =', forceRescan);
      if (!isHistoryPage()) {
        window.location.href = `https://music.youtube.com/history?autostart=1${forceRescan ? '&forceRescan=1' : ''}`;
      } else {
        injectHistoryScannerOverlay();
        startHistoryScan(forceRescan);
      }
      sendResponse({ status: 'ok' });
      return true;
    }
  });

  function init() {
    const target = document.querySelector('ytmusic-player-bar') || document.body;
    if (target) {
      observer.observe(target, { childList: true, subtree: true, characterData: true });
      checkTrackChange();
    } else {
      setTimeout(init, 800);
    }
    checkHistoryRoute();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

