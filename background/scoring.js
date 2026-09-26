/**
 * YTMusic Counter - Scoring & Album Completion Engine
 * Implements fuzzy matching, title normalization, and resilient album completion algorithms.
 */

/**
 * Normalizes track title for resilient fuzzy matching between
 * YouTube Music player bar and Remix/Browse API tracklists.
 * Strips smart quotes, hyphens, remaster/deluxe/live/bonus tags, and metadata noise.
 *
 * @param {string} str
 * @returns {string}
 */
export function normalizeTrackTitle(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .replace(/[\u2018\u2019`´]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    // Strip leading track numbers like "01. ", "1 - ", etc.
    .replace(/^\s*\d+[\.\-\s]+/g, '')
    // Strip parenthetical and bracketed remaster / bonus / live / explicit / video tags
    .replace(/\s*[\(\[]((\d{2,4}\s*)?remaster(ed)?(\s*\d{2,4})?|deluxe(\s*edition)?|bonus(\s*track)?|live(\s*at.*?)?|explicit|version|anniversary(\s*edition)?|official(\s*(music\s*|hd\s*)?video|\s*audio)?|lyric(\s*video)?|visualizer|audio|hd(\s*video)?|4k)[\)\]]/gi, '')
    // Strip trailing "- 2011 Remaster", "- Remastered", etc.
    .replace(/\s*-\s*((\d{2,4}\s*)?remaster(ed)?(\s*\d{2,4})?|deluxe|live|explicit|bonus|mono|stereo|official(\s*video)?).*$/gi, '')
    // Strip featuring artist tags like "(feat. X)" or "[ft. X]"
    .replace(/\s*[\(\[](feat\.|ft\.|featuring).*?[\)\]]/gi, '')
    // Strip remaining punctuation except alphanumeric, spaces, and single quotes
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Matches a track title against the listened dictionary using multi-tier strategy:
 * 1. Direct exact match
 * 2. Case-insensitive match
 * 3. Normalized title match
 *
 * @param {string} trackTitle
 * @param {Record<string, number>} listened
 * @returns {number} Play count of matched track, or 0
 */
export function matchTrackPlayCount(trackTitle, listened) {
  if (!trackTitle || !listened) return 0;
  
  // 1. Direct exact match
  if (typeof listened[trackTitle] === 'number') {
    return listened[trackTitle];
  }

  const listenedEntries = Object.entries(listened);

  // 2. Direct case-insensitive match
  const targetLower = trackTitle.trim().toLowerCase();
  for (const [key, count] of listenedEntries) {
    if (key.trim().toLowerCase() === targetLower) {
      return count;
    }
  }

  // 3. Normalized title match
  const normTarget = normalizeTrackTitle(trackTitle);
  if (normTarget) {
    for (const [key, count] of listenedEntries) {
      if (normalizeTrackTitle(key) === normTarget) {
        return count;
      }
    }
  }

  return 0;
}

/**
 * Calculates how many times an album has been completely listened to.
 * An album is completed if and only if EVERY track in its official tracklist (allTracks)
 * has been listened to at least N times: completePlays = Math.min(...playCounts).
 *
 * @param {object} album
 * @returns {number}
 */
export function calculateCompletePlays(album) {
  if (!album || !Array.isArray(album.allTracks) || album.allTracks.length === 0) {
    return 0;
  }

  const playCounts = album.allTracks.map(t => matchTrackPlayCount(t, album.tracksListened || {}));
  const minPlays = Math.min(...playCounts);
  return minPlays > 0 ? minPlays : 0;
}

/**
 * Cleans the stored albums dictionary:
 * - Drops singles and false album names
 * - Recomputes completePlays via calculateCompletePlays for self-healing
 * - Asynchronously updates browser storage if any repairs occurred
 *
 * @param {Record<string, any>} albums
 * @param {object} [extBrowser]
 * @returns {Record<string, any>}
 */
export function cleanAlbumsDict(albums, extBrowser = null) {
  if (!albums || typeof albums !== 'object') return {};
  const cleaned = {};
  let anyUpdated = false;

  for (const [key, val] of Object.entries(albums)) {
    if (!val || !val.album) continue;
    const name = val.album.trim().toLowerCase();
    if (name === 'single' || name === 'single - ep' || name === 'ep' || key.startsWith('single:::')) {
      continue;
    }

    // Sync totalTracks if allTracks is present
    if (Array.isArray(val.allTracks) && val.allTracks.length > 0) {
      if (val.totalTracks !== val.allTracks.length) {
        val.totalTracks = val.allTracks.length;
        anyUpdated = true;
      }
    }

    const recomputed = calculateCompletePlays(val);
    if (recomputed !== val.completePlays) {
      val.completePlays = recomputed;
      anyUpdated = true;
    }
    cleaned[key] = val;
  }

  // If any completePlays were corrected, save to storage asynchronously if browser available
  if (anyUpdated && extBrowser && extBrowser.storage && extBrowser.storage.local) {
    extBrowser.storage.local.set({ albums: cleaned }).catch(() => {});
  }

  return cleaned;
}
