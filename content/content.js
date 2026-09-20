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

      // Sanitize bullets in artist and album
      if (artist && artist.includes('•')) {
        const parts = artist.split('•').map(p => p.trim()).filter(Boolean);
        artist = parts[0] || '';
        if (!album && parts[1] && !/^\d+:\d+$/.test(parts[1])) album = parts[1];
      }

      if (album && (/^single(\s*-\s*ep)?$/i.test(album) || /^ep$/i.test(album) || /^\d+:\d+(:\d+)?$/.test(album))) {
        isSingle = true;
        album = '';
      }

      if (artist && album && artist.toLowerCase() === album.toLowerCase()) {
        album = '';
        isSingle = true;
      }
    }

    let videoId = '';
    const videoLink = document.querySelector('ytmusic-player-bar .image-link, ytmusic-player-bar a.yt-simple-endpoint[href*="watch?v="]');
    if (videoLink) {
      const href = videoLink.getAttribute('href') || '';
      const match = href.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
      if (match) videoId = match[1];
    }
    if (!videoId && window.location.search.includes('v=')) {
      const match = window.location.search.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
      if (match) videoId = match[1];
    }

    return { title, artist, album, albumBrowseId, isSingle, videoId };
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

    // 2. Extract Artist & Album via links inside secondary columns
    const secLinks = Array.from(item.querySelectorAll('.secondary-flex-columns a, yt-formatted-string.subtitle a, .subtitle a, .byline a'));
    
    const artistLinks = [];
    const albumLinks = [];

    secLinks.forEach(a => {
      const href = a.getAttribute('href') || '';
      const text = a.textContent.trim();
      if (!text) return;

      if (href.includes('browse/MPREb') || href.includes('browse/OLAK5uy') || 
          href.includes('playlist?list=OLAK5uy') || href.includes('playlist?list=MPREb')) {
        albumLinks.push(a);
      } else if (href.includes('channel/') || href.includes('browse/UC') || href.includes('browse/FEmusic_library')) {
        artistLinks.push(a);
      }
    });

    if (artistLinks.length > 0) {
      artist = artistLinks.map(a => a.textContent.trim()).filter(Boolean).join(', ');
    }

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

    // In YouTube Music bylines, link 0 is Artist, link 1 is Album
    if (!artist && secLinks.length > 0 && !albumLinks.includes(secLinks[0])) {
      artist = secLinks[0].textContent.trim();
    }
    if (!album && !isSingle && secLinks.length > 1 && !artistLinks.includes(secLinks[1])) {
      const cand = secLinks[1].textContent.trim();
      if (!/^single(\s*-\s*ep)?$/i.test(cand) && !/^ep$/i.test(cand) && !/^\d+:\d+$/.test(cand) && !/^\d{4}$/.test(cand)) {
        album = cand;
      }
    }

    // 3. Fallback: Parse secondary formatted text (split by bullet points)
    if (!artist || !album) {
      const subtitleElem = item.querySelector('.secondary-flex-columns yt-formatted-string, yt-formatted-string.subtitle, .subtitle, .byline');
      const subtitleText = subtitleElem ? subtitleElem.textContent.trim() : '';

      if (subtitleText) {
        const parts = subtitleText.split('•').map(p => p.trim()).filter(Boolean);
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

    // 4. Sanitize extracted values
    if (artist && artist.includes('•')) {
      const sub = artist.split('•').map(p => p.trim()).filter(Boolean);
      artist = sub[0] || '';
      if (!album && sub[1] && !/^\d+:\d+$/.test(sub[1])) {
        album = sub[1];
      }
    }

    if (album) {
      if (album.includes('•')) {
        album = album.split('•')[0].trim();
      }
      if (/^\d+:\d+(:\d+)?$/.test(album) || 
          /^\d{4}$/.test(album) || 
          /^\d+(\.\d+)?[KM]?\s*(plays?|views?)/i.test(album) ||
          /^single(\s*-\s*ep)?$/i.test(album) ||
          /^ep$/i.test(album)) {
        if (/^single/i.test(album)) isSingle = true;
        album = '';
      }
    }

    // Avoid artist and album being identical
    if (artist && album && artist.toLowerCase() === album.toLowerCase()) {
      album = '';
      isSingle = true;
    }

    let videoId = '';
    const videoLink = item.querySelector('a[href*="watch?v="]');
    if (videoLink) {
      const href = videoLink.getAttribute('href') || '';
      const match = href.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
      if (match) videoId = match[1];
    }

    return {
      title,
      artist: artist || 'Unknown Artist',
      album: album || '',
      albumBrowseId: albumBrowseId || '',
      isSingle: Boolean(isSingle),
      videoId
    };
  }

  /**
   * Normalizes strings for robust track comparison
   */
  function normalizeTrackStr(str) {
    return (str || '')
      .toLowerCase()
      .trim()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ');
  }

  /**
   * Compares two tracks for equality
   */
  function areTracksEqual(a, b) {
    if (!a || !b) return false;
    if (a.videoId && b.videoId && a.videoId === b.videoId) {
      return true;
    }
    const aTitle = normalizeTrackStr(a.title);
    const bTitle = normalizeTrackStr(b.title);
    if (!aTitle || !bTitle || aTitle !== bTitle) {
      return false;
    }
    const aArtist = normalizeTrackStr(a.artist);
    const bArtist = normalizeTrackStr(b.artist);
    if (aArtist && bArtist && aArtist !== 'unknown artist' && bArtist !== 'unknown artist') {
      return aArtist === bArtist || aArtist.includes(bArtist) || bArtist.includes(aArtist);
    }
    return true;
  }

  /**
   * Finds the index in parsedItems where the watermark sequence begins
   */
  function findWatermarkBoundary(parsedItems, watermark) {
    if (!Array.isArray(watermark) || watermark.length === 0) return -1;
    if (!Array.isArray(parsedItems) || parsedItems.length === 0) return -1;

    for (let i = 0; i < parsedItems.length; i++) {
      if (areTracksEqual(parsedItems[i].track, watermark[0])) {
        let matches = 1;
        const maxCheck = Math.min(watermark.length, 5);
        let sequenceValid = true;

        for (let w = 1; w < maxCheck; w++) {
          if (i + w < parsedItems.length) {
            if (areTracksEqual(parsedItems[i + w].track, watermark[w])) {
              matches++;
            } else {
              sequenceValid = false;
              break;
            }
          } else {
            break;
          }
        }

        const requiredMatches = Math.min(2, watermark.length);
        if (sequenceValid && matches >= requiredMatches) {
          return i;
        }
      }
    }

    return -1;
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
          <span class="ytmc-scanner-title">Listening History Sync</span>
        </div>
        <div class="ytmc-scanner-controls">
          <button type="button" class="ytmc-btn-mini" id="ytmc-close-btn" title="Minimize window">✕</button>
        </div>
      </div>
      <div class="ytmc-scanner-body">
        <div class="ytmc-scanner-metrics">
          <div class="ytmc-metric-card">
            <span class="ytmc-metric-label">New Songs Synced</span>
            <span class="ytmc-metric-val" id="ytmc-scan-count">0</span>
          </div>
        </div>
        <div class="ytmc-scanner-status-box">
          <div class="ytmc-status-spinner" id="ytmc-scan-spinner"></div>
          <span id="ytmc-scan-note">Ready to sync your listening history.</span>
        </div>
        <div style="font-size: 11px; color: #888; display: flex; align-items: center; gap: 6px;">
          <input type="checkbox" id="ytmc-force-rescan-cb">
          <label for="ytmc-force-rescan-cb" style="cursor: pointer;">Re-scan full history from the beginning</label>
        </div>
        <div class="ytmc-scanner-actions">
          <button type="button" class="ytmc-btn-scan-start" id="ytmc-start-scan-btn">
            <span>▶ Start Sync</span>
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const startBtn = overlay.querySelector('#ytmc-start-scan-btn');
    const closeBtn = overlay.querySelector('#ytmc-close-btn');

    startBtn.addEventListener('click', () => {
      const force = Boolean(overlay.querySelector('#ytmc-force-rescan-cb')?.checked);
      startHistoryScan(force);
    });

    closeBtn.addEventListener('click', () => {
      overlay.classList.toggle('ytmc-minimized');
      const isMin = overlay.classList.contains('ytmc-minimized');
      closeBtn.textContent = isMin ? '◻' : '✕';
      closeBtn.title = isMin ? 'Restore window' : 'Minimize window';
    });

    const titleGroup = overlay.querySelector('.ytmc-scanner-title-group');
    if (titleGroup) {
      titleGroup.style.cursor = 'pointer';
      titleGroup.title = 'Click to toggle minimize';
      titleGroup.addEventListener('click', () => {
        if (overlay.classList.contains('ytmc-minimized')) {
          overlay.classList.remove('ytmc-minimized');
          closeBtn.textContent = '✕';
          closeBtn.title = 'Minimize window';
        }
      });
    }

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

    const watermark = (!isForce && activeSyncState && Array.isArray(activeSyncState.watermark))
      ? activeSyncState.watermark
      : [];

    console.log('[YTMC Content] Starting scan. Force rescan:', isForce, 'Watermark size:', watermark.length);

    const startBtn = document.getElementById('ytmc-start-scan-btn');
    const spinner = document.getElementById('ytmc-scan-spinner');
    const note = document.getElementById('ytmc-scan-note');
    const countEl = document.getElementById('ytmc-scan-count');

    if (startBtn) startBtn.disabled = true;
    if (spinner) spinner.style.display = 'block';
    if (countEl) countEl.textContent = '0';
    if (note) {
      note.textContent = watermark.length > 0
        ? `Checking for new plays since "${watermark[0].title}"...`
        : 'Scanning your listening history...';
    }

    // Broadcast starting state
    extBrowser.storage.local.set({
      scanProgress: {
        isScanning: true,
        count: 0,
        unique: 0,
        latestTrack: null,
        statusText: watermark.length > 0 ? 'Checking for new plays...' : 'Finding plays in history...'
      }
    });

    scanInterval = setInterval(async () => {
      const itemElements = Array.from(document.querySelectorAll('ytmusic-responsive-list-item-renderer'));
      if (itemElements.length === 0) {
        return;
      }

      const parsedItems = [];
      for (const el of itemElements) {
        const track = parseTrackFromItem(el);
        if (track && track.title) {
          parsedItems.push({ element: el, track });
        }
      }

      if (parsedItems.length === 0) return;

      const hasWatermark = watermark.length > 0;

      // Mode A: Watermark Sequence Matching (Incremental Sync)
      if (hasWatermark) {
        const boundaryIndex = findWatermarkBoundary(parsedItems, watermark);

        if (boundaryIndex >= 0) {
          const newTracks = parsedItems.slice(0, boundaryIndex).map(p => p.track);
          console.log(`[YTMC Sync] Watermark boundary matched at index ${boundaryIndex}! New plays to import: ${newTracks.length}`);
          stopAndSaveHistory(true, boundaryIndex === 0 ? 'Already up to date' : 'Sync complete', newTracks, parsedItems);
          return;
        }

        // Boundary not found yet in currently loaded DOM items -> scroll to load more
        console.log(`[YTMC Sync] Watermark not found yet in ${parsedItems.length} loaded items. Scrolling...`);
        if (note) {
          note.textContent = `Scanning history... Loaded ${parsedItems.length} songs. Looking for sync boundary...`;
        }
        extBrowser.storage.local.set({
          scanProgress: {
            isScanning: true,
            count: parsedItems.length,
            unique: new Set(parsedItems.map(p => `${p.track.title.toLowerCase()}:::${(p.track.artist || '').toLowerCase()}`)).size,
            latestTrack: parsedItems[0].track,
            statusText: `Loaded ${parsedItems.length} songs. Finding sync boundary...`
          }
        });
      } else if (!isForce) {
        // Fallback for existing users without an initialized watermark
        try {
          const localData = await extBrowser.storage.local.get(['currentTrack', 'songs', 'totalPlays']);
          let fallbackBoundary = -1;

          if (localData.currentTrack && localData.currentTrack.title) {
            for (let idx = 0; idx < Math.min(parsedItems.length, 15); idx++) {
              if (areTracksEqual(parsedItems[idx].track, localData.currentTrack)) {
                fallbackBoundary = idx;
                console.log(`[YTMC Sync] Fallback: Matched currentTrack at index ${idx}`);
                break;
              }
            }
          }

          if (fallbackBoundary === -1 && localData.songs && Object.keys(localData.songs).length > 0) {
            const songsDict = localData.songs;
            for (let idx = 0; idx < Math.min(parsedItems.length, 15); idx++) {
              const item = parsedItems[idx].track;
              const key = `${(item.title || '').trim().toLowerCase()}:::${(item.artist || '').trim().toLowerCase()}`;
              if (songsDict[key] && songsDict[key].playCount > 0) {
                if (idx + 1 < parsedItems.length) {
                  const nextItem = parsedItems[idx + 1].track;
                  const nextKey = `${(nextItem.title || '').trim().toLowerCase()}:::${(nextItem.artist || '').trim().toLowerCase()}`;
                  if (songsDict[nextKey] && songsDict[nextKey].playCount > 0) {
                    fallbackBoundary = idx;
                    console.log(`[YTMC Sync] Fallback: Matched existing songs cluster starting at index ${idx}`);
                    break;
                  }
                } else {
                  fallbackBoundary = idx;
                  break;
                }
              }
            }
          }

          if (fallbackBoundary >= 0) {
            const newTracks = parsedItems.slice(0, fallbackBoundary).map(p => p.track);
            console.log(`[YTMC Sync] Fallback boundary resolved at index ${fallbackBoundary}. Importing ${newTracks.length} new tracks.`);
            stopAndSaveHistory(true, fallbackBoundary === 0 ? 'Already up to date' : 'Sync complete', newTracks, parsedItems);
            return;
          }
        } catch (e) {
          console.warn('[YTMC Sync] Fallback check error:', e);
        }
      }

      // Mode B: Full Baseline Scan (First-time setup or Force Rescan)
      if (!hasWatermark) {
        for (const p of parsedItems) {
          if (p.element.dataset.ytmcProcessed) continue;
          p.element.dataset.ytmcProcessed = 'true';
          scannedTracks.push(p.track);
        }

        const countEl = document.getElementById('ytmc-scan-count');
        const uniqueCount = new Set(scannedTracks.map(t => `${t.title.toLowerCase()}:::${(t.artist || '').toLowerCase()}`)).size;
        if (countEl) countEl.textContent = scannedTracks.length;

        extBrowser.storage.local.set({
          scanProgress: {
            isScanning: true,
            count: scannedTracks.length,
            unique: uniqueCount,
            latestTrack: scannedTracks[scannedTracks.length - 1],
            statusText: `Importing history baseline (${scannedTracks.length}/${MAX_HISTORY_SCAN_ITEMS})...`
          }
        });

        if (scannedTracks.length >= MAX_HISTORY_SCAN_ITEMS) {
          console.log(`[YTMC Content] Reached ${MAX_HISTORY_SCAN_ITEMS}-song history cap. Stopping.`);
          stopAndSaveHistory(true, `Reached ${MAX_HISTORY_SCAN_ITEMS}-song limit`, scannedTracks, parsedItems);
          return;
        }
      }

      // Smooth scroll down to load next items
      const beforeCount = itemElements.length;
      window.scrollBy({ top: 1200, behavior: 'smooth' });
      if (document.scrollingElement) document.scrollingElement.scrollTop += 1200;
      document.querySelectorAll('ytmusic-app, #browse-page, ytmusic-browse-response, #contents, #main-panel').forEach(el => {
        if (el.scrollHeight > el.clientHeight) el.scrollTop += 1200;
      });
      if (itemElements.length > 0) {
        try {
          itemElements[itemElements.length - 1].scrollIntoView({ behavior: 'smooth', block: 'end' });
        } catch (_) {}
      }

      const currentItemElements = document.querySelectorAll('ytmusic-responsive-list-item-renderer');
      if (currentItemElements.length === beforeCount) {
        idleScrollCount++;
        if (idleScrollCount >= 4) {
          console.log('[YTMC Content] End of history reached after 4 idle scroll checks.');
          if (hasWatermark) {
            const allTracks = parsedItems.map(p => p.track);
            stopAndSaveHistory(true, 'Full history scanned', allTracks, parsedItems);
          } else {
            stopAndSaveHistory(true, 'End of history reached', scannedTracks, parsedItems);
          }
          return;
        }
      } else {
        idleScrollCount = 0;
      }
    }, 650);
  }

  function stopAndSaveHistory(autoCompleted, reason = '', newTracks = null, allParsed = null) {
    if (!isScanning) return;
    isScanning = false;
    clearInterval(scanInterval);
    scanInterval = null;

    const startBtn = document.getElementById('ytmc-start-scan-btn');
    const spinner = document.getElementById('ytmc-scan-spinner');
    const note = document.getElementById('ytmc-scan-note');

    if (startBtn) startBtn.disabled = false;
    if (spinner) spinner.style.display = 'none';

    const tracksToImport = Array.isArray(newTracks) ? newTracks : scannedTracks;

    // Construct fresh watermark from top of the page
    let newWatermark = [];
    if (Array.isArray(allParsed) && allParsed.length > 0) {
      newWatermark = allParsed.slice(0, 50).map(p => ({
        title: p.track.title,
        artist: p.track.artist || 'Unknown Artist',
        album: p.track.album || '',
        videoId: p.track.videoId || ''
      }));
    } else if (tracksToImport.length > 0) {
      newWatermark = tracksToImport.slice(0, 50).map(t => ({
        title: t.title,
        artist: t.artist || 'Unknown Artist',
        album: t.album || '',
        videoId: t.videoId || ''
      }));
    } else if (activeSyncState && Array.isArray(activeSyncState.watermark)) {
      newWatermark = activeSyncState.watermark;
    }

    const topTrack = newWatermark.length > 0 ? newWatermark[0] : null;

    const newSyncState = {
      watermark: newWatermark,
      lastTrackTitle: topTrack ? topTrack.title : '',
      lastTrackArtist: topTrack ? topTrack.artist : '',
      lastSyncTimestamp: Date.now(),
      lastSyncedCount: tracksToImport.length,
      // Backward compatibility fields for legacy UI
      lastDateHeader: topTrack ? topTrack.title : 'Synced',
      syncedCountOnDate: tracksToImport.length
    };

    const countEl = document.getElementById('ytmc-scan-count');

    if (tracksToImport.length === 0) {
      if (countEl) countEl.textContent = '0';

      const msg = activeSyncState ? 'All caught up! No new plays found.' : 'No tracks found in history.';
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

    const uniqueSet = new Set(tracksToImport.map(t => `${t.title.toLowerCase()}:::${(t.artist || '').toLowerCase()}`));
    if (countEl) countEl.textContent = tracksToImport.length;

    const countLabel = tracksToImport.length === 1 ? '1 play' : `${tracksToImport.length} plays`;
    if (note) note.textContent = `Saving ${countLabel}...`;

    extBrowser.storage.local.set({
      scanProgress: {
        isScanning: true,
        count: tracksToImport.length,
        unique: uniqueSet.size,
        latestTrack: tracksToImport[0],
        statusText: `Saving ${countLabel}...`
      }
    });

    extBrowser.runtime.sendMessage({
      type: 'IMPORT_HISTORY_TRACKS',
      payload: {
        tracks: tracksToImport,
        newSyncState
      }
    }, (response) => {
      const res = response && response.data;
      const importedCount = (res && typeof res.importedCount === 'number') ? res.importedCount : tracksToImport.length;
      const uniqueCount = (res && typeof res.uniqueSongs === 'number') ? res.uniqueSongs : uniqueSet.size;
      const displayLabel = importedCount === 1 ? '1 new play' : `${importedCount} new plays`;

      if (countEl) countEl.textContent = importedCount;
      if (note) {
        note.innerHTML = `<b>Success!</b> Synced ${displayLabel} (${reason || 'Completed'}).`;
      }

      extBrowser.storage.local.set({
        scanProgress: {
          isScanning: false,
          count: importedCount,
          unique: uniqueCount,
          latestTrack: null,
          statusText: `Done! Synced ${displayLabel} (${reason || 'Completed'}).`
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

  // Live sync with storage changes (e.g. after history sync or background play updates)
  if (extBrowser.storage && extBrowser.storage.onChanged) {
    extBrowser.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local' && changes.songs) {
        const track = getCurrentTrackInfo();
        if (track && track.title) {
          const key = `${track.title.trim().toLowerCase()}:::${(track.artist || 'Unknown Artist').trim().toLowerCase()}`;
          const updatedSongs = changes.songs.newValue || {};
          if (updatedSongs[key] && typeof updatedSongs[key].playCount === 'number') {
            currentSongPlays = updatedSongs[key].playCount;
            updateSongBadge(currentSongPlays, true);
          }
        }
      }
    });
  }

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

