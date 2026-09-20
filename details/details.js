/**
 * YTMusic Counter - Details & Config Script
 * Handles real-time statistics display, tab navigation,
 * and a 3-step confirmation flow for erasing all extension data.
 */

const extBrowser = typeof browser !== 'undefined' ? browser : chrome;

// DOM Elements Cache
const elements = {
  // Navigation
  tabBtnDetails: document.getElementById('tabBtnDetails'),
  tabBtnConfig: document.getElementById('tabBtnConfig'),
  detailsPanel: document.getElementById('detailsPanel'),
  configPanel: document.getElementById('configPanel'),

  // Stats in Details Panel
  totalSongsListened: document.getElementById('totalSongsListened'),
  uniqueSongsStat: document.getElementById('uniqueSongsStat'),
  uniqueArtistsStat: document.getElementById('uniqueArtistsStat'),
  trackedAlbumsStat: document.getElementById('trackedAlbumsStat'),
  singlesStat: document.getElementById('singlesStat'),
  completedAlbumsStat: document.getElementById('completedAlbumsStat'),
  activeTrackTitle: document.getElementById('activeTrackTitle'),
  activeTrackArtist: document.getElementById('activeTrackArtist'),
  refreshAlbumsBreakdownBtn: document.getElementById('refreshAlbumsBreakdownBtn'),
  albumsBreakdownList: document.getElementById('albumsBreakdownList'),

  // 3-Step Wipe Container & Views
  wipeStep0: document.getElementById('wipeStep0'),
  wipeStep1: document.getElementById('wipeStep1'),
  wipeStep2: document.getElementById('wipeStep2'),
  wipeStep3: document.getElementById('wipeStep3'),

  // Wipe Buttons
  initiateDeleteBtn: document.getElementById('initiateDeleteBtn'),
  cancelStep1Btn: document.getElementById('cancelStep1Btn'),
  confirmStep1Btn: document.getElementById('confirmStep1Btn'),
  cancelStep2Btn: document.getElementById('cancelStep2Btn'),
  confirmStep2Btn: document.getElementById('confirmStep2Btn'),
  cancelStep3Btn: document.getElementById('cancelStep3Btn'),
  confirmStep3Btn: document.getElementById('confirmStep3Btn'),

  // Success Feedback
  deleteSuccessAlert: document.getElementById('deleteSuccessAlert'),

  // History Scanner Launcher & Live Feedback
  launchHistoryScannerBtn: document.getElementById('launchHistoryScannerBtn'),
  scannerLivePanel: document.getElementById('scannerLivePanel'),
  scannerConfigSpinner: document.getElementById('scannerConfigSpinner'),
  scannerLiveBadge: document.getElementById('scannerLiveBadge'),
  scannerLiveCounts: document.getElementById('scannerLiveCounts'),
  scannerImportingTrack: document.getElementById('scannerImportingTrack'),
  historySyncPill: document.getElementById('historySyncPill'),
  historySyncDot: document.getElementById('historySyncDot'),
  historySyncText: document.getElementById('historySyncText'),
  forceRescanCheckbox: document.getElementById('forceRescanCheckbox'),

  // Diagnostics & Debug Elements
  debugPingBtn: document.getElementById('debugPingBtn'),
  debugCheckStorageBtn: document.getElementById('debugCheckStorageBtn'),
  debugResetSyncBtn: document.getElementById('debugResetSyncBtn'),
  debugClearLogsBtn: document.getElementById('debugClearLogsBtn'),
  debugTabStatus: document.getElementById('debugTabStatus'),
  debugStorageStatus: document.getElementById('debugStorageStatus'),
  debugSyncBoundaryStatus: document.getElementById('debugSyncBoundaryStatus'),
  debugScanStatus: document.getElementById('debugScanStatus'),
  debugConsole: document.getElementById('debugConsole')
};

/* ==========================================================================
   Tab Navigation
   ========================================================================== */
function setupTabs() {
  const tabs = [
    { btn: elements.tabBtnDetails, panel: elements.detailsPanel },
    { btn: elements.tabBtnConfig, panel: elements.configPanel }
  ];

  tabs.forEach(({ btn, panel }) => {
    if (!btn || !panel) return;
    btn.addEventListener('click', () => {
      tabs.forEach(t => {
        t.btn.classList.remove('active');
        t.btn.setAttribute('aria-selected', 'false');
        t.panel.classList.remove('active');
      });

      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      panel.classList.add('active');
    });
  });
}

/* ==========================================================================
   Statistics Retrieval & Rendering
   ========================================================================== */
async function loadStats() {
  try {
    extBrowser.runtime.sendMessage({ type: 'GET_STATS' }, (response) => {
      if (extBrowser.runtime.lastError) {
        console.warn('[Details] Background communication error:', extBrowser.runtime.lastError);
        fetchStatsDirectlyFromStorage();
        return;
      }
      if (response && response.status === 'ok') {
        renderStats(response.data);
      } else {
        fetchStatsDirectlyFromStorage();
      }
    });
  } catch (err) {
    console.error('[Details] Error requesting stats:', err);
    fetchStatsDirectlyFromStorage();
  }
}

// Fallback to direct storage access if background messaging fails
async function fetchStatsDirectlyFromStorage() {
  try {
    const data = await extBrowser.storage.local.get(['totalPlays', 'songs', 'artists', 'albums', 'currentTrack']);
    const songs = data.songs || {};
    const artists = data.artists || {};
    const rawAlbums = data.albums || {};

    const cleanedAlbums = {};
    for (const [key, val] of Object.entries(rawAlbums)) {
      if (val && val.album && val.album.toLowerCase() !== 'single' && val.album.toLowerCase() !== 'ep' && !key.startsWith('single:::')) {
        cleanedAlbums[key] = val;
      }
    }
    const singlesCount = Object.values(songs).filter(s => s.isSingle || !s.album).length;
    const completedAlbumsCount = Object.values(cleanedAlbums).reduce((sum, a) => sum + (a.completePlays || 0), 0);

    const compiledStats = {
      totalPlays: data.totalPlays || 0,
      uniqueSongsCount: Object.keys(songs).length,
      uniqueArtistsCount: Object.keys(artists).length,
      uniqueAlbumsCount: Object.keys(cleanedAlbums).length,
      singlesCount,
      completedAlbumsCount,
      topAlbums: Object.values(cleanedAlbums).sort((a, b) => ((b.completePlays || 0) * 100 + (b.playCount || 0)) - ((a.completePlays || 0) * 100 + (a.playCount || 0))),
      currentTrack: data.currentTrack || null
    };
    renderStats(compiledStats);
  } catch (storageErr) {
    console.error('[Details] Storage fallback error:', storageErr);
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderStats(stats) {
  if (!stats) return;

  // Primary Row: Total Songs Listened
  if (elements.totalSongsListened) {
    const formattedCount = (stats.totalPlays || 0).toLocaleString();
    const prev = elements.totalSongsListened.textContent;
    if (prev !== formattedCount) {
      elements.totalSongsListened.textContent = formattedCount;
      elements.totalSongsListened.classList.add('bump');
      setTimeout(() => elements.totalSongsListened.classList.remove('bump'), 250);
    }
  }

  // Supporting metrics
  if (elements.uniqueSongsStat) {
    elements.uniqueSongsStat.textContent = (stats.uniqueSongsCount || 0).toLocaleString();
  }
  if (elements.uniqueArtistsStat) {
    elements.uniqueArtistsStat.textContent = (stats.uniqueArtistsCount || 0).toLocaleString();
  }
  if (elements.trackedAlbumsStat) {
    elements.trackedAlbumsStat.textContent = (stats.uniqueAlbumsCount || 0).toLocaleString();
  }
  if (elements.singlesStat) {
    elements.singlesStat.textContent = (stats.singlesCount || 0).toLocaleString();
  }
  if (elements.completedAlbumsStat) {
    elements.completedAlbumsStat.textContent = (stats.completedAlbumsCount || 0).toLocaleString();
  }

  // Active track info
  if (elements.activeTrackTitle && elements.activeTrackArtist) {
    if (stats.currentTrack && stats.currentTrack.title) {
      elements.activeTrackTitle.textContent = stats.currentTrack.title;
      elements.activeTrackArtist.textContent = [stats.currentTrack.artist, stats.currentTrack.album]
        .filter(Boolean)
        .join(' • ') + (stats.currentTrack.songPlays ? ` (${stats.currentTrack.songPlays} plays)` : '');
    } else {
      elements.activeTrackTitle.textContent = 'No track currently active';
      elements.activeTrackArtist.textContent = 'Listen to music on music.youtube.com';
    }
  }

  // Render Albums Breakdown List
  renderAlbumsBreakdown(stats.topAlbums || []);
}

function renderAlbumsBreakdown(albums) {
  if (!elements.albumsBreakdownList) return;
  if (!albums || albums.length === 0) {
    elements.albumsBreakdownList.innerHTML = '<div class="empty-state-card">No albums tracked yet. Scan your listening history to view albums.</div>';
    return;
  }

  elements.albumsBreakdownList.innerHTML = '';
  albums.forEach((album, idx) => {
    const card = document.createElement('div');
    card.className = 'album-breakdown-card';
    const uniqueTracks = album.uniqueTracksCount || (album.tracksListened ? Object.keys(album.tracksListened).length : 1);
    const isCompleted = Boolean(album.completePlays > 0 || (album.totalTracks && uniqueTracks >= album.totalTracks));

    let statusText = '';
    if (album.totalTracks) {
      statusText = `${uniqueTracks}/${album.totalTracks} songs (${Math.round((uniqueTracks / album.totalTracks) * 100)}%)`;
    } else if (album.completePlays > 0) {
      statusText = `★ Full Album (${album.completePlays}x)`;
    } else {
      statusText = `${uniqueTracks} ${uniqueTracks === 1 ? 'song' : 'songs'} listened`;
    }

    const cardId = `album-card-${idx}`;
    card.innerHTML = `
      <div class="album-card-top">
        <div class="album-card-left">
          <div class="album-icon-badge ${isCompleted ? 'completed' : ''}">
            ${isCompleted ? '★' : '💿'}
          </div>
          <div class="album-meta-text">
            <div class="album-name" title="${escapeHtml(album.album)}">${escapeHtml(album.album)}</div>
            <div class="album-artist" title="${escapeHtml(album.artist)}">${escapeHtml(album.artist)} • ${album.playCount} total ${album.playCount === 1 ? 'play' : 'plays'}</div>
          </div>
        </div>
        <div class="album-card-right">
          <span class="album-status-pill ${isCompleted ? 'completed' : ''}">${statusText}</span>
          <button type="button" class="btn-toggle-album-tracks" data-index="${idx}">
            Compare Tracks
          </button>
        </div>
      </div>
      <div class="album-card-expanded" id="${cardId}">
        <div style="font-size: 11px; text-transform: uppercase; color: var(--text-muted); font-weight: 600; margin-bottom: 6px;">
          Tracks you listened to (${uniqueTracks}):
        </div>
        <div class="tracks-list-grid" id="${cardId}-tracks">
        </div>
      </div>
    `;

    const tracksContainer = card.querySelector(`#${cardId}-tracks`);
    const listenedObj = album.tracksListened || {};
    const listenedKeys = Object.keys(listenedObj);
    if (listenedKeys.length > 0) {
      listenedKeys.forEach(tTitle => {
        const chip = document.createElement('span');
        chip.className = 'track-chip listened';
        chip.innerHTML = `<span>✓ ${escapeHtml(tTitle)}</span> <span class="track-chip-count">${listenedObj[tTitle]}x</span>`;
        tracksContainer.appendChild(chip);
      });
    } else {
      const chip = document.createElement('span');
      chip.className = 'track-chip listened';
      chip.textContent = 'Album tracks tracked';
      tracksContainer.appendChild(chip);
    }

    // Toggle button
    const toggleBtn = card.querySelector('.btn-toggle-album-tracks');
    const expandedSection = card.querySelector(`#${cardId}`);
    toggleBtn.addEventListener('click', async () => {
      const isActive = expandedSection.classList.toggle('active');
      toggleBtn.textContent = isActive ? 'Hide Tracks' : 'Compare Tracks';

      if (isActive && album.albumBrowseId && !album.totalTracks) {
        toggleBtn.textContent = 'Fetching tracklist...';
        extBrowser.runtime.sendMessage({
          type: 'GET_ALBUM_DETAILS',
          payload: { album: album.album, artist: album.artist }
        }, (res) => {
          toggleBtn.textContent = 'Hide Tracks';
          if (res && res.status === 'ok' && res.data) {
            const fullAlbum = res.data;
            if (fullAlbum.allTracks && fullAlbum.allTracks.length > 0) {
              tracksContainer.innerHTML = '';
              fullAlbum.allTracks.forEach(title => {
                const count = listenedObj[title] || 0;
                const chip = document.createElement('span');
                if (count > 0) {
                  chip.className = 'track-chip listened';
                  chip.innerHTML = `<span>✓ ${escapeHtml(title)}</span> <span class="track-chip-count">${count}x</span>`;
                } else {
                  chip.className = 'track-chip unplayed';
                  chip.innerHTML = `<span>○ ${escapeHtml(title)}</span>`;
                }
                tracksContainer.appendChild(chip);
              });

              const pill = card.querySelector('.album-status-pill');
              if (pill && fullAlbum.totalTracks) {
                const pct = Math.round((uniqueTracks / fullAlbum.totalTracks) * 100);
                pill.textContent = `${uniqueTracks}/${fullAlbum.totalTracks} songs (${pct}%)`;
                if (uniqueTracks >= fullAlbum.totalTracks && fullAlbum.totalTracks > 1) {
                  pill.classList.add('completed');
                  pill.textContent = `★ 100% Completed (${uniqueTracks}/${fullAlbum.totalTracks})`;
                  card.querySelector('.album-icon-badge').classList.add('completed');
                  card.querySelector('.album-icon-badge').textContent = '★';
                }
              }
            }
          }
        });
      }
    });

    elements.albumsBreakdownList.appendChild(card);
  });
}

/* ==========================================================================
   3-Step Confirmation Delete Flow
   ========================================================================== */
function setWipeStep(stepIndex) {
  const steps = [elements.wipeStep0, elements.wipeStep1, elements.wipeStep2, elements.wipeStep3];
  steps.forEach((step, idx) => {
    if (!step) return;
    if (idx === stepIndex) {
      step.classList.add('active');
    } else {
      step.classList.remove('active');
    }
  });
}

function setupWipeDataWorkflow() {
  // Step 0 -> Step 1
  if (elements.initiateDeleteBtn) {
    elements.initiateDeleteBtn.addEventListener('click', () => {
      hideSuccessAlert();
      setWipeStep(1);
    });
  }

  // Step 1: Cancel -> Step 0
  if (elements.cancelStep1Btn) {
    elements.cancelStep1Btn.addEventListener('click', () => {
      setWipeStep(0);
    });
  }

  // Step 1 -> Step 2 (First Confirmation)
  if (elements.confirmStep1Btn) {
    elements.confirmStep1Btn.addEventListener('click', () => {
      setWipeStep(2);
    });
  }

  // Step 2: Cancel -> Step 0
  if (elements.cancelStep2Btn) {
    elements.cancelStep2Btn.addEventListener('click', () => {
      setWipeStep(0);
    });
  }

  // Step 2 -> Step 3 (Second Confirmation)
  if (elements.confirmStep2Btn) {
    elements.confirmStep2Btn.addEventListener('click', () => {
      setWipeStep(3);
    });
  }

  // Step 3: Cancel -> Step 0
  if (elements.cancelStep3Btn) {
    elements.cancelStep3Btn.addEventListener('click', () => {
      setWipeStep(0);
    });
  }

  // Step 3 -> Execute Deletion (Third & Final Confirmation)
  if (elements.confirmStep3Btn) {
    elements.confirmStep3Btn.addEventListener('click', async () => {
      await executeDataWipe();
    });
  }
}

async function executeDataWipe() {
  try {
    // 1. Send reset message to background service
    extBrowser.runtime.sendMessage({ type: 'RESET_STATS' }, async (response) => {
      // Direct storage reset as foolproof fallback
      await extBrowser.storage.local.clear();
      await extBrowser.storage.local.set({
        totalPlays: 0,
        songs: {},
        artists: {},
        albums: {},
        currentTrack: null
      });

      // 2. Return UI to step 0
      setWipeStep(0);

      // 3. Show success alert
      showSuccessAlert();

      // 4. Reload stats immediately
      loadStats();
    });
  } catch (err) {
    console.error('[Details] Error during data wipe:', err);
    // Direct fallback
    await extBrowser.storage.local.clear();
    await extBrowser.storage.local.set({
      totalPlays: 0,
      songs: {},
      artists: {},
      albums: {},
      currentTrack: null
    });
    setWipeStep(0);
    showSuccessAlert();
    loadStats();
  }
}

function showSuccessAlert() {
  if (!elements.deleteSuccessAlert) return;
  elements.deleteSuccessAlert.style.display = 'flex';
  setTimeout(() => {
    hideSuccessAlert();
  }, 5000);
}

function hideSuccessAlert() {
  if (!elements.deleteSuccessAlert) return;
  elements.deleteSuccessAlert.style.display = 'none';
}

/* ==========================================================================
   Real-Time Storage Synchronization & Live Scanner Feedback
   ========================================================================== */
function renderScanProgress(scanProgress) {
  if (!elements.scannerLivePanel) return;

  if (!scanProgress) {
    elements.scannerLivePanel.style.display = 'none';
    return;
  }

  if (scanProgress.isScanning) {
    elements.scannerLivePanel.style.display = 'flex';
    if (elements.scannerConfigSpinner) elements.scannerConfigSpinner.classList.remove('done');
    if (elements.scannerLiveBadge) {
      elements.scannerLiveBadge.textContent = 'Scanning & Importing...';
      elements.scannerLiveBadge.classList.remove('badge-done');
    }
    if (elements.scannerLiveCounts) {
      const plays = scanProgress.count || 0;
      const unique = scanProgress.unique || 0;
      elements.scannerLiveCounts.textContent = `${plays} ${plays === 1 ? 'play' : 'plays'} (${unique} unique)`;
    }
    if (elements.scannerImportingTrack) {
      if (scanProgress.latestTrack && scanProgress.latestTrack.title) {
        const t = scanProgress.latestTrack;
        elements.scannerImportingTrack.textContent = `🎵 "${t.title}" • ${t.artist || 'Unknown'}${t.album ? ` (${t.album})` : ''}`;
      } else {
        elements.scannerImportingTrack.textContent = scanProgress.statusText || 'Auto-scrolling history entries...';
      }
    }
  } else if (scanProgress.statusText && scanProgress.count > 0) {
    elements.scannerLivePanel.style.display = 'flex';
    if (elements.scannerConfigSpinner) elements.scannerConfigSpinner.classList.add('done');
    if (elements.scannerLiveBadge) {
      elements.scannerLiveBadge.textContent = 'Completed';
      elements.scannerLiveBadge.classList.add('badge-done');
    }
    if (elements.scannerLiveCounts) {
      elements.scannerLiveCounts.textContent = `${scanProgress.count} plays imported`;
    }
    if (elements.scannerImportingTrack) {
      elements.scannerImportingTrack.textContent = scanProgress.statusText;
    }
  } else {
    elements.scannerLivePanel.style.display = 'none';
  }
}

async function checkScanProgress() {
  try {
    const data = await extBrowser.storage.local.get(['scanProgress']);
    if (data && data.scanProgress) {
      renderScanProgress(data.scanProgress);
    }
  } catch (err) {
    console.error('[Details] Error checking scanProgress:', err);
  }
}

function renderHistorySyncStatus(syncState) {
  if (!elements.historySyncText) return;

  if (!syncState || !syncState.lastDateHeader) {
    elements.historySyncText.textContent = 'Sync Status: Baseline scan needed (Full scan mode)';
    if (elements.historySyncDot) elements.historySyncDot.classList.remove('active');
    if (elements.debugSyncBoundaryStatus) elements.debugSyncBoundaryStatus.textContent = 'Boundary: None';
  } else {
    elements.historySyncText.textContent = `Sync Status: Incremental active (Boundary: "${syncState.lastDateHeader}", ${syncState.syncedCountOnDate} plays)`;
    if (elements.historySyncDot) elements.historySyncDot.classList.add('active');
    if (elements.debugSyncBoundaryStatus) {
      elements.debugSyncBoundaryStatus.textContent = `Boundary: "${syncState.lastDateHeader}" (${syncState.syncedCountOnDate} plays)`;
    }
  }
}

async function checkHistorySyncStatus() {
  try {
    const data = await extBrowser.storage.local.get(['historySyncState']);
    renderHistorySyncStatus(data && data.historySyncState);
  } catch (err) {
    console.error('[Details] Error checking historySyncState:', err);
  }
}

if (extBrowser.storage && extBrowser.storage.onChanged) {
  extBrowser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local') {
      loadStats();
      if (changes.scanProgress) {
        renderScanProgress(changes.scanProgress.newValue);
      }
      if (changes.historySyncState) {
        renderHistorySyncStatus(changes.historySyncState.newValue);
        refreshDebugStatusBar();
      }
    }
  });
}

// Initialization on DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
  setupTabs();
  setupWipeDataWorkflow();
  setupHistoryScannerLauncher();
  setupDebugSection();
  if (elements.refreshAlbumsBreakdownBtn) {
    elements.refreshAlbumsBreakdownBtn.addEventListener('click', loadStats);
  }
  loadStats();
  checkScanProgress();
  checkHistorySyncStatus();
});

/* ==========================================================================
   DEBUGGING & DIAGNOSTICS MODULE (Easily Reversible)
   ========================================================================== */
function debugLog(tag, message, data) {
  const now = new Date().toTimeString().split(' ')[0];
  let text = `[${now}] [${tag}] ${message}`;
  if (data !== undefined) {
    text += '\n' + (typeof data === 'object' ? JSON.stringify(data, null, 2) : String(data));
  }
  console.log(`[YTMC Debug] [${tag}]`, message, data !== undefined ? data : '');
  if (elements.debugConsole) {
    elements.debugConsole.textContent = text + '\n' + elements.debugConsole.textContent.slice(0, 4000);
  }
}

function setupDebugSection() {
  // Update tags
  refreshDebugStatusBar();

  // Ping button
  if (elements.debugPingBtn) {
    elements.debugPingBtn.addEventListener('click', async () => {
      debugLog('PING', 'Querying for open YouTube Music tabs...');
      try {
        const tabs = await extBrowser.tabs.query({ url: '*://music.youtube.com/*' });
        debugLog('PING', `tabs.query found ${tabs.length} tabs.`, tabs.map(t => ({ id: t.id, url: t.url, active: t.active })));
        if (tabs.length === 0) {
          debugLog('PING', 'WARNING: No tab matching *://music.youtube.com/* is currently open.');
          if (elements.debugTabStatus) elements.debugTabStatus.textContent = 'YT Tab: None Open';
          return;
        }

        const targetTab = tabs[0];
        debugLog('PING', `Sending PING_CONTENT_SCRIPT to tab ${targetTab.id}...`);
        extBrowser.tabs.sendMessage(targetTab.id, { type: 'PING_CONTENT_SCRIPT' }, (response) => {
          if (extBrowser.runtime.lastError) {
            debugLog('PING_ERROR', 'Could not reach content script (content script might not be injected or page still loading):', extBrowser.runtime.lastError.message);
            if (elements.debugTabStatus) elements.debugTabStatus.textContent = 'YT Tab: Unreachable (Reload tab)';
            return;
          }
          debugLog('PING_SUCCESS', 'Received response from content script:', response);
          if (elements.debugTabStatus) {
            elements.debugTabStatus.textContent = `YT Tab: Connected (${response.itemsCount || 0} items)`;
          }
        });
      } catch (err) {
        debugLog('PING_EXCEPTION', 'Error during ping:', err.message || err);
      }
    });
  }

  // Check storage button
  if (elements.debugCheckStorageBtn) {
    elements.debugCheckStorageBtn.addEventListener('click', async () => {
      try {
        const allData = await extBrowser.storage.local.get(null);
        debugLog('STORAGE_DUMP', 'Current storage.local contents:', allData);
        refreshDebugStatusBar(allData);
      } catch (err) {
        debugLog('STORAGE_ERROR', 'Failed to inspect storage:', err.message || err);
      }
    });
  }

  // Reset sync boundary button
  if (elements.debugResetSyncBtn) {
    elements.debugResetSyncBtn.addEventListener('click', async () => {
      try {
        await extBrowser.storage.local.remove(['historySyncState']);
        debugLog('SYNC_RESET', 'historySyncState cleared. Next scan will run in full baseline mode.');
        renderHistorySyncStatus(null);
        refreshDebugStatusBar();
      } catch (err) {
        debugLog('SYNC_RESET_ERROR', 'Failed to clear sync boundary:', err.message || err);
      }
    });
  }

  // Clear logs button
  if (elements.debugClearLogsBtn) {
    elements.debugClearLogsBtn.addEventListener('click', () => {
      if (elements.debugConsole) elements.debugConsole.textContent = 'Debug console cleared.';
    });
  }
}

async function refreshDebugStatusBar(data) {
  try {
    const storageData = data || await extBrowser.storage.local.get(null);
    if (elements.debugStorageStatus) {
      const plays = storageData.totalPlays || 0;
      const songs = Object.keys(storageData.songs || {}).length;
      const artists = Object.keys(storageData.artists || {}).length;
      const albums = Object.keys(storageData.albums || {}).length;
      elements.debugStorageStatus.textContent = `Storage: ${plays} plays, ${songs} songs, ${artists} artists, ${albums} albums`;
    }
    if (elements.debugScanStatus) {
      const scan = storageData.scanProgress;
      elements.debugScanStatus.textContent = scan && scan.isScanning ? `Scanner: ACTIVE (${scan.count} plays)` : 'Scanner: Idle';
    }
  } catch (_) {}
}

function setupHistoryScannerLauncher() {
  if (!elements.launchHistoryScannerBtn) return;

  elements.launchHistoryScannerBtn.addEventListener('click', async () => {
    debugLog('LAUNCHER', 'Launch Scanner button clicked.');
    
    // Show immediate live feedback
    renderScanProgress({
      isScanning: true,
      count: 0,
      unique: 0,
      latestTrack: null,
      statusText: 'Connecting to YouTube Music...'
    });

    const forceRescan = Boolean(elements.forceRescanCheckbox && elements.forceRescanCheckbox.checked);
    debugLog('LAUNCHER', `Force full rescan enabled: ${forceRescan}`);

    const historyUrl = `https://music.youtube.com/history?autostart=1${forceRescan ? '&forceRescan=1' : ''}`;
    try {
      debugLog('LAUNCHER', 'Querying tabs for *://music.youtube.com/* ...');
      const tabs = await extBrowser.tabs.query({ url: '*://music.youtube.com/*' });
      debugLog('LAUNCHER', `Found ${tabs.length} tabs matching YouTube Music.`, tabs.map(t => ({ id: t.id, url: t.url })));

      if (tabs.length > 0) {
        const targetTab = tabs[0];
        debugLog('LAUNCHER', `Directing existing tab ${targetTab.id} to ${historyUrl}...`);
        await extBrowser.tabs.update(targetTab.id, { url: historyUrl, active: true });
        if (targetTab.windowId) {
          await extBrowser.windows.update(targetTab.windowId, { focused: true });
        }
        // Try messaging content script directly in case it is already on the page
        setTimeout(() => {
          debugLog('LAUNCHER', `Sending START_HISTORY_SCAN message (forceRescan=${forceRescan}) to tab ${targetTab.id}...`);
          extBrowser.tabs.sendMessage(targetTab.id, { type: 'START_HISTORY_SCAN', forceRescan }, (res) => {
            if (extBrowser.runtime.lastError) {
              debugLog('LAUNCHER', 'Tab navigating; autostart parameter will trigger on page load.');
            } else {
              debugLog('LAUNCHER', 'START_HISTORY_SCAN message acknowledged:', res);
            }
          });
        }, 1000);
      } else {
        debugLog('LAUNCHER', `No existing tab found. Creating new tab with ${historyUrl}...`);
        const newTab = await extBrowser.tabs.create({ url: historyUrl });
        debugLog('LAUNCHER', `Created new tab with ID ${newTab.id}.`);
      }
    } catch (err) {
      debugLog('LAUNCHER_ERROR', 'Error querying/creating tabs:', err.message || err);
      window.open(historyUrl, '_blank');
    }
  });
}
