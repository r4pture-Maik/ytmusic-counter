/**
 * YTMusic Counter - Native MV3 Background Service Worker
 * Orchestrates scoring, persistent storage, thumbnail caching,
 * continuous playback duration accumulation, and Schema v2 data bridges.
 */

import {
  normalizeTrackTitle,
  matchTrackPlayCount,
  calculateCompletePlays,
  cleanAlbumsDict
} from './scoring.js';

import {
  makeSongKey,
  makeArtistKey,
  makeAlbumKey,
  normalizeTrack,
  sanitizeStorageData,
  initializeStorage,
  getStats,
  resetStats,
  invalidateStatsCache,
  createExportBundleV2,
  validateAndMigrateImport,
  importHistoryTracks
} from './storage.js';

import {
  thumbnailCache,
  clearThumbnailCache,
  getThumbnailStats,
  cacheRemoteThumbnail
} from './thumbnails.js';

import {
  recordListeningDuration,
  formatDuration
} from './duration.js';

import {
  ENRICHMENT_CONFIG_KEY,
  selectAlbumsToEnrich,
  shouldEnrichAlbum,
  normalizeBrowseId,
  isRateLimitedStatus,
  parseBrowsePayload,
  resolveEnrichmentConfig,
  createThrottledQueue
} from './enrichment.js';

// Side-effect import: registers the shared browse parsers on `globalThis.YTMCShared`.
// The same file is injected as a classic script into the content script, so both
// worlds share one implementation of the browse-response parsing.
import '../shared/browse-parse.js';

const { extractTrackTitlesFromBrowse, findBestThumbnail, buildBrowseRequestBody } = globalThis.YTMCShared;

const extBrowser = typeof browser !== 'undefined' ? browser : chrome;

/**
 * Forwards a diagnostic line to the Details page debug console.
 * Silently no-ops when no receiver is listening (e.g. the page is closed).
 *
 * @param {string} tag
 * @param {string} message
 * @param {any} [data]
 */
function debugLog(tag, message, data) {
  try {
    const payload = { type: 'DEBUG_LOG', tag, message };
    if (data !== undefined) payload.data = data;
    const maybePromise = extBrowser.runtime.sendMessage(payload);
    if (maybePromise && typeof maybePromise.catch === 'function') maybePromise.catch(() => {});
  } catch (_) {}
}

// Listen for storage changes to invalidate the stats cache
if (extBrowser.storage && extBrowser.storage.onChanged) {
  extBrowser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local') {
      const keys = ['songs', 'artists', 'albums', 'totalPlays', 'totalListeningSeconds', 'currentTrack'];
      if (keys.some(k => k in changes)) {
        invalidateStatsCache();
      }
    }
  });
}

// Initialize default storage schema & heal corrupted entries upon service worker start
initializeStorage(extBrowser).then(() => {
  autoHealMissingTracklists();
}).catch(() => {});

/**
 * Resolves the effective enrichment options, honouring the user override stored
 * under `enrichmentConfig`.
 *
 * @returns {Promise<{minUniqueTracks: number, minDelayMs: number, maxDelayMs: number, maxRetries: number}>}
 */
async function getEnrichmentConfig() {
  try {
    const data = await extBrowser.storage.local.get([ENRICHMENT_CONFIG_KEY]);
    return resolveEnrichmentConfig(data[ENRICHMENT_CONFIG_KEY]);
  } catch (_) {
    return resolveEnrichmentConfig(null);
  }
}

/**
 * Downloads a tracklist for every album that is still missing one.
 *
 * By default only albums that cleared the `uniqueTracksCount` threshold are
 * touched; pass `force` to sweep everything (used by the manual tool). Requests
 * go one at a time through the throttled queue, so the extension never bursts
 * the browse endpoint, and progress is mirrored into `scanProgress.statusText`
 * for the history-scanner UI.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.force] Ignore the `uniqueTracksCount` threshold.
 * @param {string} [opts.progressPrefix] Prefix for the `scanProgress.statusText` line.
 * @returns {Promise<{total: number, updated: number, failed: number, skipped: number}>}
 */
async function runAlbumEnrichment(opts) {
  const options = opts || {};
  const config = await getEnrichmentConfig();
  const selectOptions = {
    minUniqueTracks: config.minUniqueTracks,
    force: Boolean(options.force)
  };

  const data = await extBrowser.storage.local.get(['albums', 'scanProgress']);
  const candidates = selectAlbumsToEnrich(data.albums || {}, selectOptions);
  const total = candidates.length;
  const prefix = options.progressPrefix || 'Fetching metadata';

  if (total === 0) return { total: 0, updated: 0, failed: 0, skipped: 0 };

  debugLog('BG_ENRICH', `Queued ${total} albums for enrichment (threshold: ${config.minUniqueTracks} unique tracks${options.force ? ', forced' : ''}).`);

  let scanProgress = data.scanProgress || {};
  let updated = 0;
  let failed = 0;
  let skipped = 0;

  for (let i = 0; i < candidates.length; i++) {
    const [albumKey, album] = candidates[i];

    scanProgress = { ...scanProgress, statusText: `${prefix} (${i + 1}/${total})...` };
    await extBrowser.storage.local.set({ scanProgress }).catch(() => {});

    const resolved = await ensureAlbumTracklist(albumKey, album.albumBrowseId);
    if (resolved === true) {
      updated++;
    } else if (resolved === null) {
      skipped++;
    } else {
      failed++;
      debugLog('BG_ENRICH_ERR', `Could not resolve a tracklist for ${albumKey}.`);
    }
  }

  scanProgress = { ...scanProgress, statusText: `${prefix} complete: ${updated}/${total} tracklists resolved.` };
  await extBrowser.storage.local.set({ scanProgress }).catch(() => {});
  debugLog('BG_ENRICH', `Enrichment finished: ${updated} updated, ${failed} unresolved, ${skipped} skipped, out of ${total}.`);

  return { total, updated, failed, skipped };
}

async function autoHealMissingTracklists() {
  try {
    const config = await getEnrichmentConfig();
    const data = await extBrowser.storage.local.get(['albums']);
    const candidates = selectAlbumsToEnrich(data.albums || {}, { minUniqueTracks: config.minUniqueTracks });

    for (const [albKey, alb] of candidates) {
      ensureAlbumTracklist(albKey, alb.albumBrowseId);
    }
  } catch (_) {}
}

// Chrome / WebExtensions runtime message dispatcher
extBrowser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return;

  switch (message.type) {
    case 'GET_SONG_COUNT': {
      getSongCount(message.payload)
        .then(result => sendResponse({ status: 'ok', data: result }))
        .catch(err => sendResponse({ status: 'error', error: err.message }));
      return true;
    }

    case 'TRACK_PLAYED': {
      handleTrackPlayed(message.payload)
        .then(result => sendResponse({ status: 'ok', data: result }))
        .catch(err => sendResponse({ status: 'error', error: err.message }));
      return true;
    }

    case 'TIME_LISTENED_TICK': {
      recordListeningDuration(message.payload, extBrowser, invalidateStatsCache)
        .then(result => sendResponse({ status: 'ok', data: result }))
        .catch(err => sendResponse({ status: 'error', error: err.message }));
      return true;
    }

    case 'GET_STATS': {
      getStats(extBrowser)
        .then(stats => sendResponse({ status: 'ok', data: stats }))
        .catch(err => sendResponse({ status: 'error', error: err.message }));
      return true;
    }

    case 'GET_ALBUM_DETAILS': {
      handleGetAlbumDetails(message.payload)
        .then(details => sendResponse({ status: 'ok', data: details }))
        .catch(err => sendResponse({ status: 'error', error: err.message }));
      return true;
    }

    case 'FETCH_ALBUM_COVER': {
      handleFetchAlbumCover(message.payload)
        .then(result => sendResponse({ status: 'ok', data: result }))
        .catch(err => sendResponse({ status: 'error', error: err.message }));
      return true;
    }

    case 'RESET_STATS': {
      resetStats(extBrowser, thumbnailCache)
        .then(res => sendResponse({ status: 'ok', data: res }))
        .catch(err => sendResponse({ status: 'error', error: err.message }));
      return true;
    }

    case 'IMPORT_HISTORY_TRACKS': {
      handleImportHistory(message.payload)
        .then(result => sendResponse({ status: 'ok', data: result }))
        .catch(err => sendResponse({ status: 'error', error: err.message }));
      return true;
    }

    case 'BACKFILL_ALBUM_COVERS': {
      handleBackfillAlbumCovers(message.payload)
        .then(result => sendResponse({ status: 'ok', data: result }))
        .catch(err => sendResponse({ status: 'error', error: err.message }));
      return true;
    }

    case 'GET_ENRICHMENT_CONFIG': {
      getEnrichmentConfig()
        .then(config => sendResponse({ status: 'ok', data: config }))
        .catch(err => sendResponse({ status: 'error', error: err.message }));
      return true;
    }

    case 'SET_ENRICHMENT_CONFIG': {
      handleSetEnrichmentConfig(message.payload)
        .then(config => sendResponse({ status: 'ok', data: config }))
        .catch(err => sendResponse({ status: 'error', error: err.message }));
      return true;
    }

    case 'FETCH_MISSING_TRACKLISTS': {
      handleFetchMissingTracklists(message.payload)
        .then(result => sendResponse({ status: 'ok', data: result }))
        .catch(err => sendResponse({ status: 'error', error: err.message }));
      return true;
    }

    case 'GET_THUMBNAIL_STATS': {
      getThumbnailStats()
        .then(stats => sendResponse({ status: 'ok', data: stats }))
        .catch(err => sendResponse({ status: 'error', error: err.message }));
      return true;
    }

    case 'CLEAR_THUMBNAIL_CACHE': {
      clearThumbnailCache()
        .then(res => sendResponse({ status: 'ok', data: res }))
        .catch(err => sendResponse({ status: 'error', error: err.message }));
      return true;
    }

    case 'EXPORT_DATA_V2': {
      handleExportDataV2()
        .then(bundle => sendResponse({ status: 'ok', data: bundle }))
        .catch(err => sendResponse({ status: 'error', error: err.message }));
      return true;
    }

    case 'IMPORT_DATA_V2': {
      handleImportDataV2(message.payload)
        .then(res => sendResponse({ status: 'ok', data: res }))
        .catch(err => sendResponse({ status: 'error', error: err.message }));
      return true;
    }

    default:
      sendResponse({ status: 'ignored' });
      break;
  }
});

/**
 * Returns the current play count for a specific song
 */
async function getSongCount(payload) {
  if (!payload || !payload.title) return { songPlays: 0 };
  const songKey = makeSongKey(payload.title, payload.artist);
  const data = await extBrowser.storage.local.get(['songs']);
  const songs = data.songs || {};
  const songPlays = (songs[songKey] && songs[songKey].playCount) || 0;
  return { songPlays };
}

/**
 * Records a track play and updates song, artist, and total counters
 */
async function handleTrackPlayed(rawTrack) {
  const track = normalizeTrack(rawTrack);
  if (!track || !track.title) return { totalPlays: 0, songPlays: 0 };

  const data = await extBrowser.storage.local.get(['totalPlays', 'totalListeningSeconds', 'songs', 'artists', 'albums']);
  const totalPlays = (data.totalPlays || 0) + 1;
  const songs = data.songs || {};
  const artists = data.artists || {};
  const albums = cleanAlbumsDict(data.albums || {}, extBrowser);

  const songKey = makeSongKey(track.title, track.artist);
  const isSingle = Boolean(track.isSingle || !track.album || /^single(\s*-\s*ep)?$/i.test(track.album) || /^ep$/i.test(track.album));
  const albumName = isSingle ? '' : (track.album || '');

  // Update Song count
  if (!songs[songKey]) {
    songs[songKey] = {
      title: track.title,
      artist: track.artist || 'Unknown Artist',
      album: albumName,
      isSingle: isSingle,
      playCount: 1,
      durationSeconds: 0
    };
  } else {
    songs[songKey].playCount = (songs[songKey].playCount || 0) + 1;
    if (albumName && !songs[songKey].album) songs[songKey].album = albumName;
    if (typeof track.isSingle !== 'undefined') songs[songKey].isSingle = isSingle;
  }

  // Update Artist count (handles multiple artists separated by comma or feat)
  if (track.artist) {
    const artistList = track.artist.split(/[,&/]| feat\.? | ft\.? /i).map(a => a.trim()).filter(Boolean);
    artistList.forEach(rawName => {
      const aKey = makeArtistKey(rawName);
      if (!artists[aKey]) {
        artists[aKey] = { artist: rawName, playCount: 1, durationSeconds: 0 };
      } else {
        artists[aKey].playCount = (artists[aKey].playCount || 0) + 1;
      }
    });
  }

  // Update Album count - ONLY for real albums (not singles)
  if (albumName) {
    const albumKey = makeAlbumKey(albumName, track.artist);
    if (!albums[albumKey]) {
      albums[albumKey] = {
        album: albumName,
        artist: track.artist || 'Unknown Artist',
        albumBrowseId: track.albumBrowseId || '',
        coverUrl: track.coverUrl || '',
        tracksListened: {
          [track.title]: 1
        },
        uniqueTracksCount: 1,
        totalTracks: null,
        playCount: 1,
        durationSeconds: 0,
        completePlays: 0
      };
    } else {
      albums[albumKey].playCount = (albums[albumKey].playCount || 0) + 1;
      if (!albums[albumKey].tracksListened) albums[albumKey].tracksListened = {};
      albums[albumKey].tracksListened[track.title] = (albums[albumKey].tracksListened[track.title] || 0) + 1;
      albums[albumKey].uniqueTracksCount = Object.keys(albums[albumKey].tracksListened).length;
      if (track.albumBrowseId && !albums[albumKey].albumBrowseId) {
        albums[albumKey].albumBrowseId = track.albumBrowseId;
      }
      if (track.coverUrl && !albums[albumKey].coverUrl) {
        albums[albumKey].coverUrl = track.coverUrl;
      }
    }

    // Level 2 (live tracking): the album being played right now always earns its
    // tracklist, regardless of the batch threshold. The request still goes
    // through the throttled queue, so it cannot stampede the browse endpoint.
    if (shouldEnrichAlbum(albums[albumKey], { force: true })) {
      ensureAlbumTracklist(albumKey, albums[albumKey].albumBrowseId);
    }
    if (!albums[albumKey].totalTracks && Array.isArray(albums[albumKey].allTracks) && albums[albumKey].allTracks.length > 0) {
      albums[albumKey].totalTracks = albums[albumKey].allTracks.length;
    }
    if (albums[albumKey].totalTracks || albums[albumKey].allTracks) {
      albums[albumKey].completePlays = calculateCompletePlays(albums[albumKey]);
    }
  }

  const currentTrack = {
    title: track.title,
    artist: track.artist || 'Unknown Artist',
    album: albumName,
    isSingle,
    songPlays: songs[songKey].playCount
  };

  await extBrowser.storage.local.set({
    totalPlays,
    songs,
    artists,
    albums,
    currentTrack
  });

  invalidateStatsCache();

  return {
    totalPlays,
    songPlays: songs[songKey].playCount,
    currentTrack
  };
}



/**
 * Handles 1-click export of data bundle conforming to Schema v2
 */
async function handleExportDataV2() {
  const data = await extBrowser.storage.local.get([
    'totalPlays',
    'totalListeningSeconds',
    'songs',
    'artists',
    'albums',
    'historySyncState'
  ]);
  return createExportBundleV2(data);
}

/**
 * Handles validated import and migration of Schema v1 or v2 backups
 */
async function handleImportDataV2(payload) {
  const migration = validateAndMigrateImport(payload);
  if (!migration.valid) {
    throw new Error(migration.error || 'Invalid backup data.');
  }

  const bundle = migration.bundle;
  await extBrowser.storage.local.set({
    totalPlays: bundle.totalPlays,
    totalListeningSeconds: bundle.totalListeningSeconds,
    songs: bundle.songs,
    artists: bundle.artists,
    albums: bundle.albums,
    historySyncState: bundle.historySyncState
  });

  invalidateStatsCache();

  // Enrich tracklists for imported albums that have a browse ID but no allTracks.
  // The threshold barrier inside runAlbumEnrichment keeps this from hammering
  // YouTube Music with ~100 requests for albums that hold a single listened track.
  try {
    await runAlbumEnrichment({ progressPrefix: 'Fetching metadata for new albums' });
  } catch (err) {
    console.warn('[YTMusic Counter] Album enrichment after import failed:', err);
  }

  return {
    success: true,
    totalPlays: bundle.totalPlays,
    totalListeningSeconds: bundle.totalListeningSeconds,
    songsCount: Object.keys(bundle.songs).length,
    artistsCount: Object.keys(bundle.artists).length,
    albumsCount: Object.keys(bundle.albums).length
  };
}

/**
 * Imports an array of tracks extracted from the YouTube Music History page
 */
async function handleImportHistory(payload) {
  const result = await importHistoryTracks(payload, extBrowser);

  // Trigger background enrichment for browse IDs if needed
  try {
    await runAlbumEnrichment({ progressPrefix: 'Fetching metadata' });
  } catch (err) {
    console.warn('[YTMusic Counter] Error enriching album tracklists after import:', err);
  }

  return result;
}

/**
 * Returns detailed album data with listened tracks vs full album tracklist
 */
async function handleGetAlbumDetails(payload) {
  if (!payload || !payload.album) return null;
  const data = await extBrowser.storage.local.get(['albums']);
  const albums = cleanAlbumsDict(data.albums || {}, extBrowser);
  const albumKey = makeAlbumKey(payload.album, payload.artist);
  let album = albums[albumKey];
  if (!album) {
    const matchKey = Object.keys(albums).find(k => k.toLowerCase() === albumKey.toLowerCase());
    if (matchKey) album = albums[matchKey];
  }
  if (!album) return null;

  if (album.albumBrowseId && (!album.allTracks || album.allTracks.length === 0)) {
    try {
      // Level 3 (on-demand): a single throttled request, delegated to the page origin.
      const fetched = await tracklistQueue.enqueue(() => fetchAlbumTrackCount(album.albumBrowseId));
      if (fetched && fetched.trackTitles && fetched.trackTitles.length > 0) {
        album.totalTracks = fetched.totalTracks || fetched.trackTitles.length;
        album.allTracks = fetched.trackTitles;
        album.completePlays = calculateCompletePlays(album);
        const actualKey = albums[albumKey] ? albumKey : Object.keys(albums).find(k => k.toLowerCase() === albumKey.toLowerCase());
        if (actualKey) {
          albums[actualKey] = album;
          await extBrowser.storage.local.set({ albums });
          invalidateStatsCache();
        }
      }
    } catch (_) {}
  } else if (album.totalTracks && album.allTracks) {
    album.completePlays = calculateCompletePlays(album);
  }

  return album;
}

/**
 * Serial, self-throttling queue guarding every album browse request.
 * Tasks are spaced by a random 500-800ms delay and back off exponentially
 * whenever YouTube answers with 429/403.
 */
let tracklistQueue = createThrottledQueue();

/**
 * Rebuilds the throttled queue with the delays currently configured by the user.
 * Called after the threshold/delays are changed from the Details page.
 */
async function reconfigureTracklistQueue() {
  const config = await getEnrichmentConfig();
  tracklistQueue = createThrottledQueue({
    minDelayMs: config.minDelayMs,
    maxDelayMs: config.maxDelayMs,
    maxRetries: config.maxRetries
  });
  return config;
}

/**
 * Sends a message to a tab's content script and normalizes the callback API
 * into a promise, rejecting when the content script is unreachable.
 *
 * @param {number} tabId
 * @param {object} message
 * @param {number} [timeoutMs]
 * @returns {Promise<any>}
 */
function sendMessageToTab(tabId, message, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error(`Content script timed out after ${timeoutMs || 15000}ms`));
      }
    }, timeoutMs || 15000);

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };

    try {
      const maybePromise = extBrowser.tabs.sendMessage(tabId, message, (response) => {
        const lastError = extBrowser.runtime.lastError;
        if (lastError) {
          finish(reject, new Error(lastError.message || 'Content script unreachable'));
          return;
        }
        finish(resolve, response);
      });

      // Firefox returns a promise; the callback above may never fire in that case.
      if (maybePromise && typeof maybePromise.then === 'function') {
        maybePromise.then(
          (response) => finish(resolve, response),
          (err) => finish(reject, err instanceof Error ? err : new Error(String(err && err.message ? err.message : err)))
        );
      }
    } catch (err) {
      finish(reject, err instanceof Error ? err : new Error(String(err)));
    }
  });
}

/**
 * Finds a YouTube Music tab whose content script can perform same-origin
 * browse requests. Prefers the focused/active tab, then any audible one.
 *
 * @returns {Promise<number|null>} Tab ID, or null when no usable tab is open.
 */
async function findMusicTabId() {
  try {
    const tabs = await extBrowser.tabs.query({ url: '*://music.youtube.com/*' });
    if (!tabs || tabs.length === 0) return null;

    const preferred =
      tabs.find((tab) => tab.active) ||
      tabs.find((tab) => tab.audible) ||
      tabs.find((tab) => tab.highlighted) ||
      tabs[0];

    if (!preferred) return null;

    // A discarded tab has no content script until it is restored.
    if (preferred.discarded) {
      await extBrowser.tabs.update(preferred.id, { active: true }).catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
    return preferred.id;
  } catch (_) {
    return null;
  }
}

/**
 * Direct (service worker) browse request. Used only as a fallback when no
 * YouTube Music tab is available to proxy the call, or when the delegation
 * fails for a non-throttling reason.
 *
 * @param {string} cleanId
 * @returns {Promise<object|null>}
 */
async function fetchAlbumTrackCountDirect(cleanId) {
  const res = await fetch('https://music.youtube.com/youtubei/v1/browse?prettyPrint=false', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildBrowseRequestBody(cleanId))
  });

  if (!res.ok) {
    const err = new Error(`Direct browse request failed with HTTP ${res.status}`);
    err.status = res.status;
    err.rateLimited = isRateLimitedStatus(res.status);
    throw err;
  }

  return parseBrowsePayload(await res.json(), { extractTrackTitlesFromBrowse, findBestThumbnail });
}

/**
 * Resolves an album's official tracklist and cover art.
 *
 * Delegation strategy:
 *  1. Find an open `music.youtube.com` tab and ask its content script to run the
 *     browse POST from the page origin. This is what avoids the HTTP 403 Firefox
 *     returns for `moz-extension://` origins.
 *  2. Fall back to a direct service worker fetch when no tab is open.
 *
 * Rate limiting (429/403) is surfaced to the caller as `rateLimited: true` so the
 * throttled queue can apply exponential backoff instead of hammering the endpoint.
 *
 * @param {string} browseId
 * @returns {Promise<{totalTracks: number|null, trackTitles: string[], coverUrl: string|null}|null>}
 */
async function fetchAlbumTrackCount(browseId) {
  const cleanId = normalizeBrowseId(browseId);
  if (!cleanId) return null;

  const tabId = await findMusicTabId();
  if (tabId !== null) {
    try {
      const response = await sendMessageToTab(tabId, { type: 'FETCH_ALBUM_TRACKLIST', browseId: cleanId });

      if (response && response.status === 'ok' && response.data) {
        debugLog('BG_ENRICH', `Delegated browse for ${cleanId} via tab ${tabId}: ${response.data.trackTitles.length} tracks${response.usedPageContext ? ' (live page context)' : ' (fallback context)'}.`);
        return response.data;
      }
      if (response && response.status === 'empty') {
        debugLog('BG_ENRICH', `Delegated browse for ${cleanId} returned no tracks or artwork: ${response.error || 'no reason given'}.`);
        return null;
      }
      if (response && response.rateLimited) {
        debugLog('BG_ENRICH', `Delegated browse for ${cleanId} was rate limited (HTTP ${response.httpStatus}).`);
        return { rateLimited: true };
      }

      // Never collapse this to a bare 'unknown error': the delegated content script
      // always sends a reason, and the status code is what actually matters.
      if (!response) {
        debugLog('BG_ENRICH', `Delegated browse for ${cleanId} got an empty response from tab ${tabId}. Falling back to direct fetch.`);
      } else {
        debugLog('BG_ENRICH', `Delegated browse for ${cleanId} failed [response: ${JSON.stringify(response)}]. Falling back to direct fetch.`);
      }
    } catch (err) {
      debugLog('BG_ENRICH', `Could not reach content script in tab ${tabId}: ${(err && err.message) || err}. Falling back to direct fetch.`);
    }
  } else {
    debugLog('BG_ENRICH', 'No music.youtube.com tab open; using direct fetch for ' + cleanId);
  }

  try {
    return await fetchAlbumTrackCountDirect(cleanId);
  } catch (err) {
    if (err && err.rateLimited) {
      return { rateLimited: true };
    }
    console.warn('[YTMusic Counter] Error fetching album metadata:', err);
    return null;
  }
}

let googleSearchCooldownUntil = 0;

async function resolveAlbumCover(album, artist, browseId) {
  let coverUrl = null;
  const cleanAlb = (album || '').replace(/\s*[\(\[].*?[\)\]]/g, '').trim();
  const cleanArt = (artist || '').split('•')[0].split(/[,&/]| feat/i)[0].trim();

  // Tier 1: YouTube Music Browse endpoint (authoritative artwork for the album)
  if (browseId) {
    try {
      const cleanId = browseId.startsWith('VL') ? browseId : (browseId.startsWith('OLAK5uy') ? `VL${browseId}` : browseId);
      const res = await fetch('https://music.youtube.com/youtubei/v1/browse?prettyPrint=false', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context: {
            client: {
              clientName: 'WEB_REMIX',
              clientVersion: '1.20240101.01.00'
            }
          },
          browseId: cleanId
        })
      });
      if (res.ok) {
        const json = await res.json();
        coverUrl = findBestThumbnail(json);
      }
    } catch (_) {}
  }

  // Tier 2: YouTube Music Search endpoint, for albums with no browseId (if not in cooldown)
  const isGoogleThrottled = Date.now() < googleSearchCooldownUntil;

  if (!coverUrl && (cleanAlb || cleanArt) && !isGoogleThrottled) {
    try {
      const searchRes = await fetch('https://music.youtube.com/youtubei/v1/search?prettyPrint=false', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context: {
            client: {
              clientName: 'WEB_REMIX',
              clientVersion: '1.20240101.01.00'
            }
          },
          query: `${cleanAlb} ${cleanArt}`.trim()
        })
      });

      if (searchRes.status === 429 || searchRes.status === 403) {
        googleSearchCooldownUntil = Date.now() + 10 * 60 * 1000;
        console.warn('[YTMusic Counter] Google rate-limited search. Cooldown active for 10 minutes.');
      } else if (searchRes.ok) {
        const json = await searchRes.json();
        coverUrl = findBestThumbnail(json);
      }
    } catch (err) {
      console.warn('[YTMusic Counter] Native search error:', err);
    }
  }

  if (!coverUrl && cleanAlb && Date.now() >= googleSearchCooldownUntil) {
    try {
      const searchRes = await fetch('https://music.youtube.com/youtubei/v1/search?prettyPrint=false', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context: {
            client: {
              clientName: 'WEB_REMIX',
              clientVersion: '1.20240101.01.00'
            }
          },
          query: cleanAlb
        })
      });

      if (searchRes.status === 429 || searchRes.status === 403) {
        googleSearchCooldownUntil = Date.now() + 10 * 60 * 1000;
        console.warn('[YTMusic Counter] Google rate-limited search. Cooldown active for 10 minutes.');
      } else if (searchRes.ok) {
        const json = await searchRes.json();
        coverUrl = findBestThumbnail(json);
      }
    } catch (_) {}
  }

  return coverUrl;
}

const coverQueue = [];
let isProcessingQueue = false;

function enqueueCoverRequest(album, artist, browseId) {
  return new Promise((resolve) => {
    coverQueue.push({ album, artist, browseId, resolve });
    processCoverQueue();
  });
}

async function processCoverQueue() {
  if (isProcessingQueue || coverQueue.length === 0) return;
  isProcessingQueue = true;

  while (coverQueue.length > 0) {
    const item = coverQueue.shift();
    try {
      const url = await resolveAlbumCover(item.album, item.artist, item.browseId);
      item.resolve(url);
    } catch (_) {
      item.resolve(null);
    }
    if (coverQueue.length > 0) {
      await new Promise(r => setTimeout(r, 1200));
    }
  }

  isProcessingQueue = false;
}

async function handleFetchAlbumCover(payload) {
  if (!payload || !payload.album) return { coverUrl: null };
  const albumName = payload.album;
  const artistName = payload.artist || '';
  const albumKey = makeAlbumKey(albumName, artistName);

  const data = await extBrowser.storage.local.get(['albums']);
  const albums = cleanAlbumsDict(data.albums || {}, extBrowser);

  if (albums[albumKey] && albums[albumKey].coverUrl) {
    return { coverUrl: albums[albumKey].coverUrl };
  }

  const browseId = payload.browseId || (albums[albumKey] && albums[albumKey].albumBrowseId);
  const coverUrl = await enqueueCoverRequest(albumName, artistName, browseId);

  if (coverUrl) {
    thumbnailCache.cacheRemoteThumbnail(albumKey, coverUrl).catch(() => {});
    const freshData = await extBrowser.storage.local.get(['albums']);
    const freshAlbums = cleanAlbumsDict(freshData.albums || {}, extBrowser);
    if (!freshAlbums[albumKey]) {
      freshAlbums[albumKey] = {
        album: albumName,
        artist: artistName,
        albumBrowseId: browseId || '',
        coverUrl: coverUrl,
        tracksListened: {},
        uniqueTracksCount: 0,
        totalTracks: null,
        playCount: 0,
        durationSeconds: 0,
        completePlays: 0
      };
    } else {
      freshAlbums[albumKey].coverUrl = coverUrl;
    }
    await extBrowser.storage.local.set({ albums: freshAlbums });
    invalidateStatsCache();
  }

  return { coverUrl };
}

async function handleBackfillAlbumCovers(payload) {
  if (!payload || !Array.isArray(payload.covers) || payload.covers.length === 0) {
    return { updated: 0 };
  }

  const data = await extBrowser.storage.local.get(['albums']);
  const albums = cleanAlbumsDict(data.albums || {}, extBrowser);
  let updated = 0;

  for (const item of payload.covers) {
    if (!item.album || !item.coverUrl) continue;
    const albumKey = makeAlbumKey(item.album, item.artist);
    let target = albums[albumKey];
    if (!target) {
      const matchKey = Object.keys(albums).find(k => k.toLowerCase() === albumKey.toLowerCase());
      if (matchKey) target = albums[matchKey];
    }

    if (target && !target.coverUrl) {
      target.coverUrl = item.coverUrl;
      if (item.albumBrowseId && !target.albumBrowseId) {
        target.albumBrowseId = item.albumBrowseId;
      }
      updated++;
    }
  }

  if (updated > 0) {
    await extBrowser.storage.local.set({ albums });
    invalidateStatsCache();
  }

  return { updated };
}

const pendingTracklistFetches = new Set();

let albumsStorageMutex = Promise.resolve();

/**
 * Downloads an album's official tracklist (if missing) and persists it.
 *
 * All writes go through `albumsStorageMutex`, a promise chain that serializes the
 * read-modify-write cycle on the `albums` dictionary. Without it, concurrent
 * fetches would each read the same snapshot and clobber each other's writes.
 *
 * @param {string} albumKey
 * @param {string} browseId
 * @returns {Promise<boolean|null>} True when a tracklist was written, false when the
 *   download failed or came back empty, and null when the call was skipped (no
 *   browse ID, or a fetch for that album is already in flight).
 */
async function ensureAlbumTracklist(albumKey, browseId) {
  if (!browseId || pendingTracklistFetches.has(albumKey)) {
    return null;
  }
  pendingTracklistFetches.add(albumKey);

  try {
    const fetched = await tracklistQueue.enqueue(() => fetchAlbumTrackCount(browseId));
    if (!fetched || !fetched.trackTitles || fetched.trackTitles.length === 0) {
      return false;
    }

    return await new Promise((resolve) => {
      albumsStorageMutex = albumsStorageMutex.then(async () => {
        try {
          const data = await extBrowser.storage.local.get(['albums']);
          const albums = cleanAlbumsDict(data.albums || {}, extBrowser);
          const targetKey = albums[albumKey]
            ? albumKey
            : Object.keys(albums).find((k) => k.toLowerCase() === albumKey.toLowerCase());

          if (!targetKey || !albums[targetKey]) {
            console.warn('[YTMusic Counter] Could not find album in database during lock:', albumKey);
            resolve(false);
            return;
          }

          let changed = false;
          albums[targetKey].totalTracks = fetched.totalTracks || fetched.trackTitles.length;
          albums[targetKey].allTracks = fetched.trackTitles;
          albums[targetKey].completePlays = calculateCompletePlays(albums[targetKey]);
          changed = true;

          if (fetched.coverUrl && !albums[targetKey].coverUrl) {
            albums[targetKey].coverUrl = fetched.coverUrl;
          }

          if (changed) {
            await extBrowser.storage.local.set({ albums });
            invalidateStatsCache();
          }
          resolve(true);
        } catch (err) {
          console.error('[YTMusic Counter] Error persisting tracklist for', albumKey, err);
          resolve(false);
        }
      }).catch((err) => {
        console.error('[YTMusic Counter] Mutex chain error for', albumKey, err);
        resolve(false);
      });
    });
  } catch (err) {
    console.warn('[YTMusic Counter] Error ensuring album tracklist for', albumKey, err);
    return false;
  } finally {
    pendingTracklistFetches.delete(albumKey);
  }
}

/**
 * Handles the manual "Fetch Missing Tracklists" tool from the Details page.
 * Bypasses the listening-threshold barrier so every album that still lacks a
 * tracklist gets resolved, but keeps the serial throttled pacing.
 *
 * @param {object} [payload]
 * @param {boolean} [payload.force] Defaults to true; set false to honour the threshold.
 * @returns {Promise<{total: number, updated: number, failed: number, skipped: number}>}
 */
async function handleFetchMissingTracklists(payload) {
  const force = !payload || payload.force !== false;
  return runAlbumEnrichment({ force, progressPrefix: 'Fetching missing tracklists' });
}

/**
 * Persists the user-tunable enrichment options and rebuilds the throttled queue.
 *
 * @param {object} payload
 * @returns {Promise<object>} The effective (clamped) configuration.
 */
async function handleSetEnrichmentConfig(payload) {
  const incoming = payload && typeof payload === 'object' ? payload : {};
  const existing = await getEnrichmentConfig();

  const merged = { ...existing };
  for (const key of ['minUniqueTracks', 'minDelayMs', 'maxDelayMs', 'maxRetries']) {
    if (incoming[key] !== undefined && incoming[key] !== null && incoming[key] !== '') {
      merged[key] = Number(incoming[key]);
    }
  }

  const resolved = resolveEnrichmentConfig(merged);
  await extBrowser.storage.local.set({ [ENRICHMENT_CONFIG_KEY]: resolved });
  await reconfigureTracklistQueue();

  debugLog('BG_ENRICH', `Enrichment config updated: ${JSON.stringify(resolved)}`);
  return resolved;
}
