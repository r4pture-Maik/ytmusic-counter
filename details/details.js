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
  refreshAlbumsBreakdownBtn: document.getElementById('refreshAlbumsBreakdownBtn'),
  albumsBreakdownList: document.getElementById('albumsBreakdownList'),
  toggleAllAlbumsBtn: document.getElementById('toggleAllAlbumsBtn'),
  toggleAllAlbumsText: document.getElementById('toggleAllAlbumsText'),
  albumsSectionSubtext: document.getElementById('albumsSectionSubtext'),

  // Cover Art & Media Cache Elements
  thumbnailCacheStatsBadge: document.getElementById('thumbnailCacheStatsBadge'),
  thumbnailCacheCount: document.getElementById('thumbnailCacheCount'),
  thumbnailCacheSize: document.getElementById('thumbnailCacheSize'),
  refreshThumbnailCacheStatsBtn: document.getElementById('refreshThumbnailCacheStatsBtn'),
  clearThumbnailCacheBtn: document.getElementById('clearThumbnailCacheBtn'),
  thumbnailCacheOpMessage: document.getElementById('thumbnailCacheOpMessage'),

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
  toggleDebugOptions: document.getElementById('toggleDebugOptions'),
  debugSection: document.getElementById('debugSection'),
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

// State for Album Display (Top 3 vs All)
let showingAllAlbums = false;
let currentTopAlbums = [];
let currentAllAlbums = [];

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
let loadStatsTimeout = null;
function loadStatsDebounced(delay = 200) {
  if (loadStatsTimeout) clearTimeout(loadStatsTimeout);
  loadStatsTimeout = setTimeout(() => {
    loadStatsTimeout = null;
    loadStats();
  }, delay);
}

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

    const sortedAlbums = Object.values(cleanedAlbums)
      .sort((a, b) => ((b.completePlays || 0) * 100 + (b.playCount || 0)) - ((a.completePlays || 0) * 100 + (a.playCount || 0)));

    const compiledStats = {
      totalPlays: data.totalPlays || 0,
      uniqueSongsCount: Object.keys(songs).length,
      uniqueArtistsCount: Object.keys(artists).length,
      uniqueAlbumsCount: Object.keys(cleanedAlbums).length,
      singlesCount,
      completedAlbumsCount,
      topAlbums: sortedAlbums.slice(0, 3),
      allAlbums: sortedAlbums,
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


  // Render Albums Breakdown List
  currentTopAlbums = (stats.topAlbums || []).slice(0, 3);
  currentAllAlbums = (stats.allAlbums || stats.topAlbums || []);
  renderAlbumsBreakdown();
}

function computeAlbumStatusText(album, uniqueTracks, completePlays) {
  if (completePlays > 0) {
    let nextProgress = 0;
    if (album.allTracks && album.totalTracks) {
      for (const t of album.allTracks) {
        const c = (album.tracksListened && album.tracksListened[t]) || 0;
        if (c > completePlays) nextProgress++;
      }
    }
    if (nextProgress > 0 && album.totalTracks) {
      return `★ Completed (${completePlays}x) • Next: ${nextProgress}/${album.totalTracks}`;
    } else {
      return `★ Completed (${completePlays}x)`;
    }
  } else if (album.totalTracks) {
    return `${uniqueTracks}/${album.totalTracks} songs (${Math.round((uniqueTracks / album.totalTracks) * 100)}%)`;
  } else {
    return `${uniqueTracks} ${uniqueTracks === 1 ? 'song' : 'songs'} played`;
  }
}

function updateCardInPlace(card, album, idx) {
  card._albumData = album;
  const uniqueTracks = album.uniqueTracksCount || (album.tracksListened ? Object.keys(album.tracksListened).length : 1);
  const completePlays = album.completePlays || 0;
  const isCompleted = Boolean(completePlays > 0 || (album.totalTracks && album.totalTracks > 1 && uniqueTracks >= album.totalTracks));
  const statusText = computeAlbumStatusText(album, uniqueTracks, completePlays);

  const cleanArtistName = (album.artist || '').split('•')[0].trim();
  const hasDistinctArtist = cleanArtistName && cleanArtistName.toLowerCase() !== (album.album || '').toLowerCase();
  const artistSubtitle = hasDistinctArtist ? `${escapeHtml(cleanArtistName)} • ` : '';

  // Update status pill
  const pill = card.querySelector('.album-status-pill');
  if (pill) {
    pill.textContent = statusText;
    if (isCompleted) {
      pill.classList.add('completed');
    } else {
      pill.classList.remove('completed');
    }
  }

  // Update artist and plays count
  const artistEl = card.querySelector('.album-artist');
  if (artistEl) {
    artistEl.textContent = `${artistSubtitle}${album.playCount} total ${album.playCount === 1 ? 'play' : 'plays'}`;
  }

  // Update completion star & badge
  const container = card.querySelector('.album-artwork-container');
  if (container) {
    let star = container.querySelector('.album-cover-star');
    if (isCompleted && !star) {
      star = document.createElement('span');
      star.className = 'album-cover-star';
      star.title = 'Completed Album';
      star.textContent = '★';
      container.appendChild(star);
    } else if (!isCompleted && star) {
      star.remove();
    }

    const badge = container.querySelector('.album-icon-badge');
    if (badge) {
      if (isCompleted) {
        badge.classList.add('completed');
        badge.textContent = '★';
      } else {
        badge.classList.remove('completed');
        badge.textContent = '💿';
      }
    }

    // If card doesn't have an image yet and now a cached image is available
    const albumKey = card.dataset.albumKey;
    const memUrl = typeof thumbnailCache !== 'undefined' ? thumbnailCache.getMemoryObjectUrl(albumKey) : null;
    if (memUrl && !container.querySelector('.album-cover-img')) {
      applyCoverToCard(container, memUrl, album.album);
    }
  }

  // If expanded section is active, update tracks in real time
  const expandedSection = card.querySelector('.album-card-expanded');
  if (expandedSection && expandedSection.classList.contains('active')) {
    const tracksContainer = card.querySelector('.tracks-list-grid');
    if (tracksContainer) {
      renderTrackChips(tracksContainer, album);
    }
  }
}

function renderTrackChips(tracksContainer, currentAlbum) {
  if (!tracksContainer || !currentAlbum) return;
  const listenedObj = currentAlbum.tracksListened || {};
  const hasAllTracks = Array.isArray(currentAlbum.allTracks) && currentAlbum.allTracks.length > 0;

  tracksContainer.innerHTML = '';

  if (hasAllTracks) {
    currentAlbum.allTracks.forEach(title => {
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
  } else {
    const entries = Object.entries(listenedObj);
    if (entries.length > 0) {
      entries.forEach(([title, count]) => {
        const chip = document.createElement('span');
        chip.className = 'track-chip listened';
        chip.innerHTML = `<span>✓ ${escapeHtml(title)}</span> <span class="track-chip-count">${count}x</span>`;
        tracksContainer.appendChild(chip);
      });
    } else {
      const chip = document.createElement('span');
      chip.className = 'track-chip listened';
      chip.innerHTML = `<span>✓ ${escapeHtml(currentAlbum.album)}</span> <span class="track-chip-count">${currentAlbum.playCount || 1}x</span>`;
      tracksContainer.appendChild(chip);
    }
  }
}

function wireAlbumCardEvents(card, album, cardId, idx) {
  const toggleBtn = card.querySelector('.btn-toggle-album-tracks');
  const expandedSection = card.querySelector(`#${cardId}`);
  const tracksContainer = card.querySelector(`#${cardId}-tracks`);
  if (!toggleBtn || !expandedSection || !tracksContainer) return;

  // Pre-render immediately so tracks are never blank
  renderTrackChips(tracksContainer, card._albumData || album);

  toggleBtn.addEventListener('click', async () => {
    const currentAlbum = card._albumData || album;
    const isActive = expandedSection.classList.toggle('active');
    toggleBtn.textContent = isActive ? 'Hide Tracks' : 'View Tracks';

    if (isActive) {
      renderTrackChips(tracksContainer, currentAlbum);

      // If full album tracklist has not been retrieved and albumBrowseId exists, fetch it
      const hasAllTracks = Array.isArray(currentAlbum.allTracks) && currentAlbum.allTracks.length > 0;
      if (!hasAllTracks && currentAlbum.albumBrowseId) {
        toggleBtn.textContent = 'Loading tracklist...';
        extBrowser.runtime.sendMessage({
          type: 'GET_ALBUM_DETAILS',
          payload: { album: currentAlbum.album, artist: currentAlbum.artist }
        }, (res) => {
          toggleBtn.textContent = 'Hide Tracks';
          if (res && res.status === 'ok' && res.data) {
            const fullAlbum = res.data;
            card._albumData = fullAlbum;
            renderTrackChips(tracksContainer, fullAlbum);

            const pill = card.querySelector('.album-status-pill');
            if (pill && fullAlbum.totalTracks) {
              const uniqueTracks = fullAlbum.uniqueTracksCount || Object.keys(fullAlbum.tracksListened || {}).length;
              const pct = Math.round((uniqueTracks / fullAlbum.totalTracks) * 100);
              pill.textContent = `${uniqueTracks}/${fullAlbum.totalTracks} songs (${pct}%)`;
              if (uniqueTracks >= fullAlbum.totalTracks && fullAlbum.totalTracks > 1) {
                pill.classList.add('completed');
                pill.textContent = `★ 100% Completed (${uniqueTracks}/${fullAlbum.totalTracks})`;
                const badge = card.querySelector('.album-icon-badge');
                if (badge) {
                  badge.classList.add('completed');
                  badge.textContent = '★';
                }
              }
            }
          }
        });
      }
    }
  });
}

function buildAlbumCard(album, idx) {
  const card = document.createElement('div');
  card.className = 'album-breakdown-card';
  const albumKey = makeAlbumKey(album.album, album.artist);
  card.dataset.albumKey = albumKey;
  card.dataset.index = idx;
  card._albumData = album;

  const uniqueTracks = album.uniqueTracksCount || (album.tracksListened ? Object.keys(album.tracksListened).length : 1);
  const completePlays = album.completePlays || 0;
  const isCompleted = Boolean(completePlays > 0 || (album.totalTracks && album.totalTracks > 1 && uniqueTracks >= album.totalTracks));
  const statusText = computeAlbumStatusText(album, uniqueTracks, completePlays);

  const cleanArtistName = (album.artist || '').split('•')[0].trim();
  const hasDistinctArtist = cleanArtistName && cleanArtistName.toLowerCase() !== (album.album || '').toLowerCase();
  const artistSubtitle = hasDistinctArtist ? `${escapeHtml(cleanArtistName)} • ` : '';

  const cardId = `album-card-${idx}`;
  const artId = `album-art-${idx}`;

  // Check if thumbnail Object URL is already available in memory
  const memoryCoverUrl = typeof thumbnailCache !== 'undefined' ? thumbnailCache.getMemoryObjectUrl(albumKey) : null;
  const initialCoverUrl = memoryCoverUrl || (album.coverUrl && !album.coverUrl.startsWith('http') ? album.coverUrl : null);

  const artworkHtml = initialCoverUrl
    ? `<div class="album-artwork-container" id="${artId}">
        <img class="album-cover-img" src="${escapeHtml(initialCoverUrl)}" alt="${escapeHtml(album.album)}" onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='flex';" />
        <div class="album-icon-badge ${isCompleted ? 'completed' : ''}" style="display: none;">
          ${isCompleted ? '★' : '💿'}
        </div>
        ${isCompleted ? '<span class="album-cover-star" title="Completed Album">★</span>' : ''}
      </div>`
    : `<div class="album-artwork-container" id="${artId}">
        <div class="album-icon-badge ${isCompleted ? 'completed' : ''}">
          ${isCompleted ? '★' : '💿'}
        </div>
        ${isCompleted ? '<span class="album-cover-star" title="Completed Album">★</span>' : ''}
      </div>`;

  card.innerHTML = `
    <div class="album-card-top">
      <div class="album-card-left">
        ${artworkHtml}
        <div class="album-meta-text">
          <div class="album-name" title="${escapeHtml(album.album)}">${escapeHtml(album.album)}</div>
          <div class="album-artist" title="${escapeHtml(cleanArtistName || album.album)}">${artistSubtitle}${album.playCount} total ${album.playCount === 1 ? 'play' : 'plays'}</div>
        </div>
      </div>
      <div class="album-card-right">
        <span class="album-status-pill ${isCompleted ? 'completed' : ''}">${statusText}</span>
        <button type="button" class="btn-toggle-album-tracks" data-index="${idx}">
          View Tracks
        </button>
      </div>
    </div>
    <div class="album-card-expanded" id="${cardId}">
      <div style="font-size: 11px; text-transform: uppercase; color: var(--text-muted); font-weight: 600; margin-bottom: 6px;">
        Songs played (${uniqueTracks}):
      </div>
      <div class="tracks-list-grid" id="${cardId}-tracks">
      </div>
    </div>
  `;

  wireAlbumCardEvents(card, album, cardId, idx);

  // Lazy-load cover from IndexedDB / remote only if not already rendered
  if (!initialCoverUrl) {
    observeAlbumCard(card, album, idx);
  }

  return card;
}

function renderAlbumsBreakdown() {
  if (!elements.albumsBreakdownList) return;
  const albums = showingAllAlbums ? currentAllAlbums : currentTopAlbums;
  const totalCount = currentAllAlbums.length;

  if (elements.toggleAllAlbumsBtn && elements.toggleAllAlbumsText) {
    if (totalCount > 3) {
      elements.toggleAllAlbumsBtn.style.display = 'inline-flex';
      elements.toggleAllAlbumsText.textContent = showingAllAlbums 
        ? 'Show Top 3 Only' 
        : `Show All (${totalCount})`;
    } else {
      elements.toggleAllAlbumsBtn.style.display = 'none';
    }
  }

  if (elements.albumsSectionSubtext) {
    if (totalCount > 3) {
      elements.albumsSectionSubtext.textContent = showingAllAlbums
        ? `Showing all ${totalCount} tracked albums.`
        : `Showing Top 3 most played albums (${totalCount} total tracked).`;
    } else {
      elements.albumsSectionSubtext.textContent = `See which songs you've heard from each album and track your progress.`;
    }
  }

  if (!albums || albums.length === 0) {
    elements.albumsBreakdownList.innerHTML = '<div class="empty-state-card">No albums tracked yet. Sync your listening history or play an album to get started.</div>';
    return;
  }

  // Non-destructive DOM Reconciliation:
  // If the same albums in the same order are already rendered, update in-place without destroying DOM!
  const existingCards = Array.from(elements.albumsBreakdownList.querySelectorAll('.album-breakdown-card'));
  const targetKeys = albums.map(a => makeAlbumKey(a.album, a.artist));
  const isMatch = existingCards.length === targetKeys.length && existingCards.every((c, i) => c.dataset.albumKey === targetKeys[i]);

  if (isMatch) {
    albums.forEach((album, idx) => {
      updateCardInPlace(existingCards[idx], album, idx);
    });
    return;
  }

  // Full re-render when album list or order changes
  elements.albumsBreakdownList.innerHTML = '';
  albums.forEach((album, idx) => {
    const card = buildAlbumCard(album, idx);
    elements.albumsBreakdownList.appendChild(card);
  });
}

let albumCoverObserver = null;

function getAlbumCoverObserver() {
  if (!albumCoverObserver && 'IntersectionObserver' in window) {
    albumCoverObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const card = entry.target;
          observer.unobserve(card);
          const idx = parseInt(card.dataset.index, 10);
          const album = card._albumData;
          if (album) {
            fetchAlbumCover(album, idx, card);
          }
        }
      });
    }, {
      rootMargin: '200px 0px',
      threshold: 0.01
    });
  }
  return albumCoverObserver;
}

function observeAlbumCard(card, album, idx) {
  card.dataset.index = idx;
  card._albumData = album;
  const observer = getAlbumCoverObserver();
  if (observer) {
    observer.observe(card);
  } else {
    fetchAlbumCover(album, idx, card);
  }
}

function makeAlbumKey(album, artist) {
  return `${(album || '').trim().toLowerCase()}:::${(artist || '').trim().toLowerCase()}`;
}

async function fetchCoverFromCoverArtArchive(album, artist) {
  if (!album) return null;
  const cleanAlb = (album || '').replace(/\s*[\(\[].*?[\)\]]/g, '').trim();
  const cleanArt = (artist || '').split('•')[0].split(/[,&/]| feat/i)[0].trim();
  if (!cleanAlb) return null;

  try {
    const query = cleanArt
      ? `release:"${cleanAlb}" AND artist:"${cleanArt}"`
      : `release:"${cleanAlb}"`;
    const mbUrl = `https://musicbrainz.org/ws/2/release/?query=${encodeURIComponent(query)}&fmt=json&limit=3`;
    const mbRes = await fetch(mbUrl, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'YTMusicCounter/1.0.0 (https://github.com/r4pture-Maik/ytmusic-counter)'
      }
    });

    if (mbRes.ok) {
      const mbData = await mbRes.json();
      if (mbData.releases && mbData.releases.length > 0) {
        for (const rel of mbData.releases) {
          if (rel['cover-art-archive'] && rel['cover-art-archive'].front) {
            return `https://coverartarchive.org/release/${rel.id}/front-250.jpg`;
          }
        }
        for (const rel of mbData.releases) {
          if (rel['release-group'] && rel['release-group'].id) {
            return `https://coverartarchive.org/release-group/${rel['release-group'].id}/front-250.jpg`;
          }
        }
      }
    }
  } catch (err) {
    console.warn('[YTMusic Counter] Details CAA lookup error:', err);
  }
  return null;
}

function applyCoverToCard(container, url, albumName) {
  if (!container || !url) return;
  container.classList.remove('loading');

  const badge = container.querySelector('.album-icon-badge');
  let img = container.querySelector('.album-cover-img');

  if (!img) {
    img = document.createElement('img');
    img.className = 'album-cover-img';
    img.alt = albumName || 'Album';
    img.onerror = function () {
      this.style.display = 'none';
      if (badge) badge.style.display = 'flex';
    };
    img.onload = function () {
      if (badge) badge.style.display = 'none';
      img.style.display = 'block';
    };
    if (badge) {
      container.insertBefore(img, badge);
    } else {
      container.appendChild(img);
    }
  }

  img.src = url;
  img.style.display = 'block';
  if (badge) badge.style.display = 'none';
}

const requestedCoverKeys = new Set();
async function fetchAlbumCover(album, idx, cardEl) {
  if (!album || !album.album) return;
  const key = makeAlbumKey(album.album, album.artist);

  if (requestedCoverKeys.has(key)) return;
  requestedCoverKeys.add(key);

  // Check persistent negative cache
  if (typeof thumbnailCache !== 'undefined' && thumbnailCache.isThumbnailFailed(key)) {
    return;
  }

  const container = cardEl
    ? cardEl.querySelector('.album-artwork-container')
    : document.getElementById(`album-art-${idx}`);

  // Step 1: Check IndexedDB
  if (typeof thumbnailCache !== 'undefined') {
    try {
      const cachedUrl = await thumbnailCache.getThumbnailObjectUrl(key);
      if (cachedUrl) {
        applyCoverToCard(container, cachedUrl, album.album);
        return;
      }
    } catch (_) {}
  }

  if (container) {
    container.classList.add('loading');
  }

  // Step 2: If album already has remote coverUrl, downscale and cache into IndexedDB
  if (album.coverUrl && album.coverUrl.startsWith('http')) {
    if (typeof thumbnailCache !== 'undefined') {
      try {
        const cached = await thumbnailCache.cacheRemoteThumbnail(key, album.coverUrl);
        if (cached && cached.objectUrl) {
          applyCoverToCard(container, cached.objectUrl, album.album);
          return;
        }
      } catch (_) {}
    }
    applyCoverToCard(container, album.coverUrl, album.album);
    return;
  }

  // Step 3: Request from background script
  let resolvedUrl = null;
  try {
    const res = await new Promise((resolve) => {
      extBrowser.runtime.sendMessage({
        type: 'FETCH_ALBUM_COVER',
        payload: {
          album: album.album,
          artist: album.artist,
          browseId: album.albumBrowseId
        }
      }, (resp) => {
        if (extBrowser.runtime.lastError) {
          resolve(null);
        } else {
          resolve(resp && resp.status === 'ok' && resp.data && resp.data.coverUrl ? resp.data.coverUrl : null);
        }
      });
    });
    resolvedUrl = res;
  } catch (_) {}

  // Step 4: Cover Art Archive fallback
  if (!resolvedUrl) {
    try {
      resolvedUrl = await fetchCoverFromCoverArtArchive(album.album, album.artist);
      if (resolvedUrl) {
        const data = await extBrowser.storage.local.get(['albums']);
        const albumsDict = data.albums || {};
        if (albumsDict[key]) {
          albumsDict[key].coverUrl = resolvedUrl;
        } else {
          const matchKey = Object.keys(albumsDict).find(k => k.toLowerCase() === key.toLowerCase());
          if (matchKey) {
            albumsDict[matchKey].coverUrl = resolvedUrl;
          }
        }
        await extBrowser.storage.local.set({ albums: albumsDict });
      }
    } catch (_) {}
  }

  if (resolvedUrl) {
    album.coverUrl = resolvedUrl;
    let displayUrl = resolvedUrl;
    if (typeof thumbnailCache !== 'undefined') {
      try {
        const cached = await thumbnailCache.cacheRemoteThumbnail(key, resolvedUrl);
        if (cached && cached.objectUrl) {
          displayUrl = cached.objectUrl;
        }
      } catch (_) {}
    }
    applyCoverToCard(container, displayUrl, album.album);
  } else {
    // Negative caching: permanently mark as failed so it NEVER loops
    if (container) container.classList.remove('loading');
    if (typeof thumbnailCache !== 'undefined') {
      thumbnailCache.markThumbnailFailed(key).catch(() => {});
    }
    // Note: Do NOT delete key from requestedCoverKeys!
  }
}

function handleAlbumsStorageChange(oldAlbums, newAlbums) {
  if (!newAlbums || typeof newAlbums !== 'object') {
    loadStatsDebounced(200);
    return;
  }

  const oldKeys = Object.keys(oldAlbums || {});
  const newKeys = Object.keys(newAlbums || {});

  // Structural change (albums added/deleted) -> reload
  if (oldKeys.length !== newKeys.length) {
    loadStatsDebounced(200);
    return;
  }

  // Play count change -> reload
  let hasPlayCountChange = false;
  for (const k of newKeys) {
    const prev = oldAlbums && oldAlbums[k];
    const curr = newAlbums[k];
    if (!prev || prev.playCount !== curr.playCount || prev.completePlays !== curr.completePlays) {
      hasPlayCountChange = true;
      break;
    }
  }

  if (hasPlayCountChange) {
    loadStatsDebounced(200);
    return;
  }

  // If only coverUrl changed, update card in-place without rebuilding DOM
  if (elements.albumsBreakdownList) {
    for (const k of newKeys) {
      const prev = oldAlbums && oldAlbums[k];
      const curr = newAlbums[k];
      if (curr.coverUrl && (!prev || prev.coverUrl !== curr.coverUrl)) {
        const card = elements.albumsBreakdownList.querySelector(`[data-album-key="${k}"]`);
        if (card) {
          const container = card.querySelector('.album-artwork-container');
          if (container && !container.querySelector('.album-cover-img')) {
            fetchAlbumCover(curr, card.dataset.index, card);
          }
        }
      }
    }
  }
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

      // 2. Clear local media cache
      if (typeof thumbnailCache !== 'undefined' && thumbnailCache.clearThumbnailCache) {
        try {
          await thumbnailCache.clearThumbnailCache();
        } catch (_) {}
      }
      refreshThumbnailCacheStats();

      // 3. Return UI to step 0
      setWipeStep(0);

      // 4. Show success alert
      showSuccessAlert();

      // 5. Reload stats immediately
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
    if (typeof thumbnailCache !== 'undefined' && thumbnailCache.clearThumbnailCache) {
      try {
        await thumbnailCache.clearThumbnailCache();
      } catch (_) {}
    }
    refreshThumbnailCacheStats();
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
      elements.scannerLiveBadge.textContent = 'Syncing History...';
      elements.scannerLiveBadge.classList.remove('badge-done');
    }
    if (elements.scannerLiveCounts) {
      const plays = scanProgress.count || 0;
      const unique = scanProgress.unique || 0;
      elements.scannerLiveCounts.textContent = `${plays} ${plays === 1 ? 'play' : 'plays'} (${unique} songs)`;
    }
    if (elements.scannerImportingTrack) {
      if (scanProgress.latestTrack && scanProgress.latestTrack.title) {
        const t = scanProgress.latestTrack;
        elements.scannerImportingTrack.textContent = `🎵 "${t.title}" • ${t.artist || 'Unknown'}${t.album ? ` (${t.album})` : ''}`;
      } else {
        elements.scannerImportingTrack.textContent = scanProgress.statusText || 'Finding songs in history...';
      }
    }
  } else if (scanProgress.statusText) {
    elements.scannerLivePanel.style.display = 'flex';
    if (elements.scannerConfigSpinner) elements.scannerConfigSpinner.classList.add('done');
    if (elements.scannerLiveBadge) {
      elements.scannerLiveBadge.textContent = scanProgress.count === 0 ? 'Up to Date' : 'Completed';
      elements.scannerLiveBadge.classList.add('badge-done');
    }
    if (elements.scannerLiveCounts) {
      const plays = scanProgress.count || 0;
      elements.scannerLiveCounts.textContent = plays === 1 ? '1 play synced' : `${plays} plays synced`;
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

function formatRelativeTime(timestamp) {
  if (!timestamp) return 'recently';
  const diffSec = Math.floor((Date.now() - timestamp) / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function renderHistorySyncStatus(syncState) {
  if (!elements.historySyncText) return;

  const hasWatermark = syncState && Array.isArray(syncState.watermark) && syncState.watermark.length > 0;
  const hasLegacy = syncState && syncState.lastDateHeader;

  if (!syncState || (!hasWatermark && !hasLegacy && !syncState.lastSyncTimestamp)) {
    elements.historySyncText.textContent = 'Sync Status: Ready for first sync';
    if (elements.historySyncDot) elements.historySyncDot.classList.remove('active');
    if (elements.debugSyncBoundaryStatus) elements.debugSyncBoundaryStatus.textContent = 'Boundary: None';
    return;
  }

  const latestTitle = syncState.lastTrackTitle || (hasWatermark ? syncState.watermark[0].title : syncState.lastDateHeader);
  const timeStr = syncState.lastSyncTimestamp ? formatRelativeTime(syncState.lastSyncTimestamp) : 'recently';

  elements.historySyncText.textContent = `Sync Status: Synced ${timeStr} (Latest: "${latestTitle}")`;
  if (elements.historySyncDot) elements.historySyncDot.classList.add('active');
  if (elements.debugSyncBoundaryStatus) {
    elements.debugSyncBoundaryStatus.textContent = hasWatermark
      ? `Watermark: ${syncState.watermark.length} tracks (Top: "${latestTitle}")`
      : `Boundary: "${syncState.lastDateHeader}" (${syncState.syncedCountOnDate || 0} plays)`;
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
    if (areaName !== 'local') return;

    if (changes.scanProgress) {
      renderScanProgress(changes.scanProgress.newValue);
    }
    if (changes.historySyncState) {
      renderHistorySyncStatus(changes.historySyncState.newValue);
      refreshDebugStatusBar();
    }

    // Only reload statistics if core listening stats changed
    const counterKeys = ['songs', 'artists', 'totalPlays'];
    const hasCounterChange = counterKeys.some(k => k in changes);

    if (hasCounterChange) {
      loadStatsDebounced(250);
    } else if (changes.albums) {
      handleAlbumsStorageChange(changes.albums.oldValue, changes.albums.newValue);
    }
  });
}

/* ==========================================================================
   Thumbnail Database & Cache Settings
   ========================================================================== */
async function refreshThumbnailCacheStats() {
  if (!elements.thumbnailCacheCount || !elements.thumbnailCacheSize) return;
  if (typeof thumbnailCache === 'undefined') {
    elements.thumbnailCacheCount.textContent = '0 covers';
    elements.thumbnailCacheSize.textContent = '(0 KB)';
    return;
  }

  try {
    const stats = await thumbnailCache.getThumbnailStats();
    elements.thumbnailCacheCount.textContent = `${stats.count} covers`;
    elements.thumbnailCacheSize.textContent = `(${stats.formattedSize})`;
  } catch (err) {
    elements.thumbnailCacheCount.textContent = 'Error';
    elements.thumbnailCacheSize.textContent = '';
  }
}

function showCacheOpMessage(msg) {
  if (!elements.thumbnailCacheOpMessage) return;
  elements.thumbnailCacheOpMessage.textContent = msg;
  elements.thumbnailCacheOpMessage.style.display = 'inline';
  setTimeout(() => {
    if (elements.thumbnailCacheOpMessage) {
      elements.thumbnailCacheOpMessage.style.display = 'none';
    }
  }, 3500);
}

function setupThumbnailCacheSettings() {
  if (elements.refreshThumbnailCacheStatsBtn) {
    elements.refreshThumbnailCacheStatsBtn.addEventListener('click', async () => {
      await refreshThumbnailCacheStats();
      showCacheOpMessage('Size refreshed');
    });
  }

  if (elements.clearThumbnailCacheBtn) {
    elements.clearThumbnailCacheBtn.addEventListener('click', async () => {
      if (typeof thumbnailCache !== 'undefined') {
        elements.clearThumbnailCacheBtn.disabled = true;
        try {
          await thumbnailCache.clearThumbnailCache();
          requestedCoverKeys.clear();
          await refreshThumbnailCacheStats();
          showCacheOpMessage('Cover cache cleared!');
          renderAlbumsBreakdown();
        } catch (err) {
          showCacheOpMessage('Clear error: ' + err.message);
        } finally {
          elements.clearThumbnailCacheBtn.disabled = false;
        }
      }
    });
  }

  refreshThumbnailCacheStats();
}

// Memory cleanup on page unload
window.addEventListener('beforeunload', () => {
  if (typeof thumbnailCache !== 'undefined' && thumbnailCache.revokeAllObjectUrls) {
    thumbnailCache.revokeAllObjectUrls();
  }
});

// Initialization on DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
  setupTabs();
  setupWipeDataWorkflow();
  setupHistoryScannerLauncher();
  setupThumbnailCacheSettings();
  setupDebugSection();
  if (elements.refreshAlbumsBreakdownBtn) {
    elements.refreshAlbumsBreakdownBtn.addEventListener('click', loadStats);
  }
  if (elements.toggleAllAlbumsBtn) {
    elements.toggleAllAlbumsBtn.addEventListener('click', () => {
      showingAllAlbums = !showingAllAlbums;
      renderAlbumsBreakdown();
    });
  }
  loadStats();
  checkScanProgress();
  checkHistorySyncStatus();
});

/* ==========================================================================
   DEBUGGING & DIAGNOSTICS MODULE (Hidden Behind Debug Options Toggle)
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
  // Wire up Debug Options Toggle Switch
  if (elements.toggleDebugOptions && elements.debugSection) {
    const isDebugActive = localStorage.getItem('ytmc_show_debug') === 'true';
    elements.toggleDebugOptions.checked = isDebugActive;
    elements.debugSection.style.display = isDebugActive ? 'block' : 'none';

    elements.toggleDebugOptions.addEventListener('change', (e) => {
      const isChecked = e.target.checked;
      localStorage.setItem('ytmc_show_debug', isChecked ? 'true' : 'false');
      elements.debugSection.style.display = isChecked ? 'block' : 'none';
      if (isChecked) {
        refreshDebugStatusBar();
      }
    });
  }

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
