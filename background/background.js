/**
 * YTMusic Counter - Background Script
 * Manages aggregated counters for songs, artists, and full album listens.
 * Data is stored in compact key-value dictionaries for maximum performance and minimal footprint.
 */

const extBrowser = typeof browser !== 'undefined' ? browser : chrome;

// Helper to create consistent dictionary keys
function makeSongKey(title, artist) {
  return `${(title || '').trim().toLowerCase()}:::${(artist || '').trim().toLowerCase()}`;
}

function makeArtistKey(artist) {
  return (artist || '').trim().toLowerCase();
}

function makeAlbumKey(album, artist) {
  return `${(album || '').trim().toLowerCase()}:::${(artist || '').trim().toLowerCase()}`;
}

function cleanAlbumsDict(albums) {
  if (!albums || typeof albums !== 'object') return {};
  const cleaned = {};
  for (const [key, val] of Object.entries(albums)) {
    if (!val || !val.album) continue;
    const name = val.album.trim().toLowerCase();
    if (name === 'single' || name === 'single - ep' || name === 'ep' || key.startsWith('single:::')) {
      continue;
    }
    cleaned[key] = val;
  }
  return cleaned;
}

/**
 * Calculates how many times an album has been completely listened to.
 * An album completion is defined as: every song in the official tracklist
 * has been listened to at least N times: completePlays = min(playCount of each track).
 */
function calculateCompletePlays(album) {
  if (!album || !album.totalTracks || !Array.isArray(album.allTracks) || album.allTracks.length === 0) {
    return album ? (album.completePlays || 0) : 0;
  }

  // Multi-track albums must have more than 1 track
  if (album.totalTracks <= 1) {
    return 0;
  }

  const listened = album.tracksListened || {};
  const listenedKeys = Object.keys(listened);

  if (listenedKeys.length < album.totalTracks) {
    return 0;
  }

  let minPlays = Infinity;

  for (const trackTitle of album.allTracks) {
    let count = listened[trackTitle];
    if (typeof count !== 'number') {
      const lower = trackTitle.toLowerCase().trim();
      const matchKey = listenedKeys.find(k => {
        const kLower = k.toLowerCase().trim();
        return kLower === lower || kLower.includes(lower) || lower.includes(kLower);
      });
      count = matchKey ? listened[matchKey] : 0;
    }

    if (count < minPlays) {
      minPlays = count;
    }

    if (minPlays === 0) {
      break;
    }
  }

  return minPlays === Infinity ? 0 : minPlays;
}

// In-memory cache for compiled statistics
let statsCache = null;

function invalidateStatsCache() {
  statsCache = null;
}

if (extBrowser.storage && extBrowser.storage.onChanged) {
  extBrowser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local') {
      const keys = ['songs', 'artists', 'albums', 'totalPlays', 'currentTrack'];
      if (keys.some(k => k in changes)) {
        invalidateStatsCache();
      }
    }
  });
}

// Helper to normalize and sanitize track metadata
function normalizeTrack(rawTrack) {
  if (!rawTrack) return null;
  let title = (rawTrack.title || '').trim();
  let artist = (rawTrack.artist || '').trim();
  let album = (rawTrack.album || '').trim();
  let isSingle = Boolean(rawTrack.isSingle);

  // If artist contains bullet "•" (e.g. "Artist • Album")
  if (artist.includes('•')) {
    const parts = artist.split('•').map(p => p.trim()).filter(Boolean);
    artist = parts[0] || 'Unknown Artist';
    if (!album && parts[1] && !/^\d+:\d+$/.test(parts[1]) && !/^\d{4}$/.test(parts[1]) && !/^single/i.test(parts[1])) {
      album = parts[1];
    }
  }

  // If album contains bullet "•"
  if (album.includes('•')) {
    const parts = album.split('•').map(p => p.trim()).filter(Boolean);
    album = parts[0] || '';
  }

  // Discard album if single, ep, or duration/year
  if (album && (/^single(\s*-\s*ep)?$/i.test(album) || /^ep$/i.test(album) || /^\d+:\d+(:\d+)?$/.test(album) || /^\d{4}$/.test(album))) {
    isSingle = true;
    album = '';
  }

  // If album and artist are identical, it's not a real album
  if (album && artist && album.toLowerCase() === artist.toLowerCase()) {
    album = '';
    isSingle = true;
  }

  return {
    ...rawTrack,
    title,
    artist: artist || 'Unknown Artist',
    album,
    isSingle: isSingle || !album
  };
}

// Self-healing data sanitizer to fix any corrupted artist/album metadata
function sanitizeStorageData(data) {
  let modified = false;
  const rawSongs = data.songs || {};
  const rawAlbums = data.albums || {};
  const cleanSongs = {};
  const cleanAlbums = {};

  // 1. Sanitize songs
  for (const [key, song] of Object.entries(rawSongs)) {
    if (!song || !song.title) continue;
    let title = song.title.trim();
    let artist = (song.artist || '').trim();
    let album = (song.album || '').trim();
    let isSingle = Boolean(song.isSingle);

    if (artist.includes('•')) {
      const parts = artist.split('•').map(p => p.trim()).filter(Boolean);
      artist = parts[0] || 'Unknown Artist';
      if (!album && parts[1] && !/^\d+:\d+$/.test(parts[1]) && !/^\d{4}$/.test(parts[1]) && !/^single/i.test(parts[1])) {
        album = parts[1];
      }
      modified = true;
    }

    if (album.includes('•')) {
      const parts = album.split('•').map(p => p.trim()).filter(Boolean);
      album = parts[0] || '';
      modified = true;
    }

    if (album && (/^single(\s*-\s*ep)?$/i.test(album) || /^ep$/i.test(album) || /^\d+:\d+(:\d+)?$/.test(album) || /^\d{4}$/.test(album))) {
      isSingle = true;
      album = '';
      modified = true;
    }

    if (album && artist && album.toLowerCase() === artist.toLowerCase()) {
      album = '';
      isSingle = true;
      modified = true;
    }

    const cleanKey = makeSongKey(title, artist);
    if (cleanKey !== key) modified = true;

    if (!cleanSongs[cleanKey]) {
      cleanSongs[cleanKey] = {
        ...song,
        title,
        artist: artist || 'Unknown Artist',
        album,
        isSingle: isSingle || !album
      };
    } else {
      cleanSongs[cleanKey].playCount = (cleanSongs[cleanKey].playCount || 0) + (song.playCount || 1);
      if (album && !cleanSongs[cleanKey].album) cleanSongs[cleanKey].album = album;
      modified = true;
    }
  }

  // 2. Sanitize albums
  for (const [key, alb] of Object.entries(rawAlbums)) {
    if (!alb || !alb.album) continue;
    let albumName = alb.album.trim();
    let albumArtist = (alb.artist || '').trim();

    if (albumArtist.includes('•')) {
      albumArtist = albumArtist.split('•')[0].trim();
      modified = true;
    }

    // If albumArtist is identical to albumName, recover true artist from cleanSongs
    if (!albumArtist || albumArtist.toLowerCase() === albumName.toLowerCase()) {
      const listenedKeys = Object.keys(alb.tracksListened || {});
      let matchedArtist = '';
      for (const tTitle of listenedKeys) {
        const matchingSong = Object.values(cleanSongs).find(s => s.title.toLowerCase() === tTitle.toLowerCase());
        if (matchingSong && matchingSong.artist && matchingSong.artist.toLowerCase() !== albumName.toLowerCase()) {
          matchedArtist = matchingSong.artist;
          break;
        }
      }
      if (!matchedArtist) {
        const songWithAlbum = Object.values(cleanSongs).find(s => s.album && s.album.toLowerCase() === albumName.toLowerCase());
        if (songWithAlbum && songWithAlbum.artist && songWithAlbum.artist.toLowerCase() !== albumName.toLowerCase()) {
          matchedArtist = songWithAlbum.artist;
        }
      }

      if (matchedArtist) {
        albumArtist = matchedArtist;
        modified = true;
      }
    }

    const lowerAlb = albumName.toLowerCase();
    if (lowerAlb === 'single' || lowerAlb === 'single - ep' || lowerAlb === 'ep' || /^\d+:\d+$/.test(albumName) || /^\d{4}$/.test(albumName)) {
      modified = true;
      continue;
    }

    // Discard album if artist is still identical to album name
    if (albumArtist && albumArtist.toLowerCase() === albumName.toLowerCase()) {
      modified = true;
      continue;
    }

    const cleanAlbKey = makeAlbumKey(albumName, albumArtist);
    if (cleanAlbKey !== key) modified = true;

    if (!cleanAlbums[cleanAlbKey]) {
      cleanAlbums[cleanAlbKey] = {
        ...alb,
        album: albumName,
        artist: albumArtist || 'Unknown Artist'
      };
    } else {
      cleanAlbums[cleanAlbKey].playCount = (cleanAlbums[cleanAlbKey].playCount || 0) + (alb.playCount || 1);
      cleanAlbums[cleanAlbKey].completePlays = Math.max(cleanAlbums[cleanAlbKey].completePlays || 0, alb.completePlays || 0);
      if (alb.totalTracks && !cleanAlbums[cleanAlbKey].totalTracks) cleanAlbums[cleanAlbKey].totalTracks = alb.totalTracks;
      if (alb.allTracks && !cleanAlbums[cleanAlbKey].allTracks) cleanAlbums[cleanAlbKey].allTracks = alb.allTracks;
      if (alb.albumBrowseId && !cleanAlbums[cleanAlbKey].albumBrowseId) cleanAlbums[cleanAlbKey].albumBrowseId = alb.albumBrowseId;
      if (alb.tracksListened) {
        if (!cleanAlbums[cleanAlbKey].tracksListened) cleanAlbums[cleanAlbKey].tracksListened = {};
        for (const [t, c] of Object.entries(alb.tracksListened)) {
          cleanAlbums[cleanAlbKey].tracksListened[t] = (cleanAlbums[cleanAlbKey].tracksListened[t] || 0) + c;
        }
        cleanAlbums[cleanAlbKey].uniqueTracksCount = Object.keys(cleanAlbums[cleanAlbKey].tracksListened).length;
      }
      if (cleanAlbums[cleanAlbKey].totalTracks && cleanAlbums[cleanAlbKey].allTracks) {
        cleanAlbums[cleanAlbKey].completePlays = calculateCompletePlays(cleanAlbums[cleanAlbKey]);
      }
      modified = true;
    }
  }

  // 3. Rebuild artists dictionary purely from cleanSongs
  const cleanArtists = {};
  for (const song of Object.values(cleanSongs)) {
    if (!song.artist || song.artist === 'Unknown Artist') continue;
    const artistList = song.artist.split(/[,&/]| feat\.? | ft\.? /i).map(a => a.trim()).filter(Boolean);
    artistList.forEach(rawName => {
      const aKey = makeArtistKey(rawName);
      if (!cleanArtists[aKey]) {
        cleanArtists[aKey] = { artist: rawName, playCount: song.playCount || 1 };
      } else {
        cleanArtists[aKey].playCount += (song.playCount || 1);
      }
    });
  }

  const oldArtistCount = Object.keys(data.artists || {}).length;
  const newArtistCount = Object.keys(cleanArtists).length;
  if (oldArtistCount !== newArtistCount) modified = true;

  return {
    modified,
    songs: cleanSongs,
    artists: cleanArtists,
    albums: cleanAlbums
  };
}

// Initialize default storage schema & heal corrupted entries
async function initializeStorage() {
  try {
    const data = await extBrowser.storage.local.get(['totalPlays', 'songs', 'artists', 'albums', 'historySyncState']);
    const sanitized = sanitizeStorageData(data);
    const updates = {};
    if (typeof data.totalPlays === 'undefined') updates.totalPlays = 0;
    if (typeof data.historySyncState === 'undefined') updates.historySyncState = null;

    if (sanitized.modified || !data.songs || !data.artists || !data.albums) {
      updates.songs = sanitized.songs;
      updates.artists = sanitized.artists;
      updates.albums = sanitized.albums;
      invalidateStatsCache();
    }

    // Remove legacy 'history' if present from previous versions
    await extBrowser.storage.local.remove('history');

    if (Object.keys(updates).length > 0) {
      await extBrowser.storage.local.set(updates);
    }
  } catch (err) {
    console.error('[YTMusic Counter Background] Storage init error:', err);
  }
}

initializeStorage();

// Message listener
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

    case 'ALBUM_COMPLETED': {
      handleAlbumCompleted(message.payload)
        .then(result => sendResponse({ status: 'ok', data: result }))
        .catch(err => sendResponse({ status: 'error', error: err.message }));
      return true;
    }

    case 'GET_STATS': {
      getStats()
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
      resetStats()
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

    case 'GET_THUMBNAIL_STATS': {
      if (typeof thumbnailCache !== 'undefined' && thumbnailCache.getThumbnailStats) {
        thumbnailCache.getThumbnailStats()
          .then(stats => sendResponse({ status: 'ok', data: stats }))
          .catch(err => sendResponse({ status: 'error', error: err.message }));
      } else {
        sendResponse({ status: 'ok', data: { count: 0, totalBytes: 0, formattedSize: '0 KB' } });
      }
      return true;
    }

    case 'CLEAR_THUMBNAIL_CACHE': {
      if (typeof thumbnailCache !== 'undefined' && thumbnailCache.clearThumbnailCache) {
        thumbnailCache.clearThumbnailCache()
          .then(res => sendResponse({ status: 'ok', data: res }))
          .catch(err => sendResponse({ status: 'error', error: err.message }));
      } else {
        sendResponse({ status: 'ok', data: { cleared: true } });
      }
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

  const data = await extBrowser.storage.local.get(['totalPlays', 'songs', 'artists', 'albums']);
  const totalPlays = (data.totalPlays || 0) + 1;
  const songs = data.songs || {};
  const artists = data.artists || {};
  const albums = cleanAlbumsDict(data.albums || {});

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
      playCount: 1
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
        artists[aKey] = { artist: rawName, playCount: 1 };
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

    // Pre-cache thumbnail asynchronously into local IndexedDB
    if (track.coverUrl && typeof thumbnailCache !== 'undefined' && thumbnailCache.cacheRemoteThumbnail) {
      thumbnailCache.cacheRemoteThumbnail(albumKey, track.coverUrl).catch(() => {});
    }

    // Cumulative full album completion check
    if (albums[albumKey].totalTracks && albums[albumKey].allTracks) {
      albums[albumKey].completePlays = calculateCompletePlays(albums[albumKey]);
    } else if (albums[albumKey].albumBrowseId) {
      ensureAlbumTracklist(albumKey, albums[albumKey].albumBrowseId);
    }
  }

  const currentTrack = {
    title: track.title,
    artist: track.artist || 'Unknown Artist',
    album: albumName,
    isSingle: isSingle,
    songPlays: songs[songKey].playCount
  };

  // Prepend live play to watermark so subsequent history syncs do not double-count it
  const syncData = await extBrowser.storage.local.get(['historySyncState']);
  let historySyncState = syncData.historySyncState || {};
  let currentWatermark = Array.isArray(historySyncState.watermark) ? historySyncState.watermark : [];

  const liveEntry = {
    title: track.title,
    artist: track.artist || 'Unknown Artist',
    album: albumName,
    videoId: track.videoId || ''
  };

  historySyncState = {
    ...historySyncState,
    watermark: [liveEntry, ...currentWatermark.slice(0, 49)],
    lastTrackTitle: track.title,
    lastTrackArtist: track.artist || 'Unknown Artist',
    lastSyncTimestamp: Date.now()
  };

  await extBrowser.storage.local.set({
    totalPlays,
    songs,
    artists,
    albums,
    currentTrack,
    historySyncState
  });

  invalidateStatsCache();

  return {
    totalPlays,
    songPlays: songs[songKey].playCount,
    currentTrack
  };
}

/**
 * Records when an album has been listened from start to finish
 */
async function handleAlbumCompleted(payload) {
  if (!payload || !payload.album) return { completePlays: 0 };
  const data = await extBrowser.storage.local.get(['albums']);
  const albums = cleanAlbumsDict(data.albums || {});
  const albumKey = makeAlbumKey(payload.album, payload.artist);

  if (!albums[albumKey]) {
    albums[albumKey] = {
      album: payload.album,
      artist: payload.artist || 'Unknown Artist',
      tracksListened: {},
      uniqueTracksCount: 0,
      totalTracks: null,
      playCount: 1,
      completePlays: 1
    };
  } else {
    albums[albumKey].completePlays = (albums[albumKey].completePlays || 0) + 1;
  }

  await extBrowser.storage.local.set({ albums });
  invalidateStatsCache();
  console.log('[YTMusic Counter] Album completed:', payload.album, 'Total completions:', albums[albumKey].completePlays);
  return { completePlays: albums[albumKey].completePlays };
}

/**
 * Compiles aggregated statistics with Top 3 rankings and caching
 */
async function getStats() {
  if (statsCache) {
    return statsCache;
  }

  const data = await extBrowser.storage.local.get(['totalPlays', 'songs', 'artists', 'albums', 'currentTrack']);
  const sanitized = sanitizeStorageData(data);
  const songs = sanitized.songs;
  const artists = sanitized.artists;
  const albums = cleanAlbumsDict(sanitized.albums);

  if (sanitized.modified) {
    extBrowser.storage.local.set({
      songs: sanitized.songs,
      artists: sanitized.artists,
      albums: sanitized.albums
    }).catch(() => {});
  }

  // Sort top items for each category (Top 3)
  const topSongs = Object.values(songs)
    .sort((a, b) => b.playCount - a.playCount)
    .slice(0, 3);

  const topArtists = Object.values(artists)
    .sort((a, b) => b.playCount - a.playCount)
    .slice(0, 3);

  const sortedAlbums = Object.values(albums)
    .sort((a, b) => {
      const aScore = (a.completePlays || 0) * 100 + (a.playCount || 0);
      const bScore = (b.completePlays || 0) * 100 + (b.playCount || 0);
      return bScore - aScore;
    });

  const topAlbums = sortedAlbums.slice(0, 3);

  const singlesCount = Object.values(songs).filter(s => s.isSingle || !s.album).length;
  const completedAlbumsCount = Object.values(albums).reduce((sum, a) => sum + (a.completePlays || 0), 0);

  statsCache = {
    totalPlays: data.totalPlays || 0,
    currentTrack: data.currentTrack || null,
    uniqueSongsCount: Object.keys(songs).length,
    uniqueArtistsCount: Object.keys(artists).length,
    uniqueAlbumsCount: Object.keys(albums).length,
    singlesCount,
    completedAlbumsCount,
    topSongs,
    topArtists,
    topAlbums,
    allAlbums: sortedAlbums
  };

  return statsCache;
}

/**
 * Resets all statistics
 */
async function resetStats() {
  const emptyState = {
    totalPlays: 0,
    songs: {},
    artists: {},
    albums: {},
    currentTrack: null,
    historySyncState: null,
    scanProgress: null
  };
  await extBrowser.storage.local.clear();
  await extBrowser.storage.local.set(emptyState);
  invalidateStatsCache();

  // Clear local media cache
  if (typeof thumbnailCache !== 'undefined' && thumbnailCache.clearThumbnailCache) {
    try {
      await thumbnailCache.clearThumbnailCache();
    } catch (_) {}
  }

  return emptyState;
}

/**
 * Imports an array of tracks extracted from the YouTube Music History page
 */
async function handleImportHistory(payload) {
  const tracks = (payload && payload.tracks) || [];
  if (!Array.isArray(tracks) || tracks.length === 0) {
    return { importedCount: 0, totalPlays: 0 };
  }

  const data = await extBrowser.storage.local.get(['totalPlays', 'songs', 'artists', 'albums']);
  let totalPlays = data.totalPlays || 0;
  const songs = data.songs || {};
  const artists = data.artists || {};
  const albums = cleanAlbumsDict(data.albums || {});

  let newPlaysCount = 0;

  for (const rawTrack of tracks) {
    const track = normalizeTrack(rawTrack);
    if (!track || !track.title) continue;

    totalPlays += 1;
    newPlaysCount += 1;

    const songKey = makeSongKey(track.title, track.artist);
    const isSingle = Boolean(track.isSingle || !track.album || /^single(\s*-\s*ep)?$/i.test(track.album) || /^ep$/i.test(track.album));
    const albumName = isSingle ? '' : (track.album || '');

    // Update song count
    if (!songs[songKey]) {
      songs[songKey] = {
        title: track.title,
        artist: track.artist || 'Unknown Artist',
        album: albumName,
        isSingle: isSingle,
        playCount: 1
      };
    } else {
      songs[songKey].playCount = (songs[songKey].playCount || 0) + 1;
      if (albumName && !songs[songKey].album) {
        songs[songKey].album = albumName;
      }
      if (typeof track.isSingle !== 'undefined') {
        songs[songKey].isSingle = isSingle;
      }
    }

    // Update artists count
    if (track.artist) {
      const artistList = track.artist.split(/[,&/]| feat\.? | ft\.? /i).map(a => a.trim()).filter(Boolean);
      artistList.forEach(rawName => {
        const aKey = makeArtistKey(rawName);
        if (!artists[aKey]) {
          artists[aKey] = { artist: rawName, playCount: 1 };
        } else {
          artists[aKey].playCount = (artists[aKey].playCount || 0) + 1;
        }
      });
    }

    // Update albums count - ONLY for real albums (not singles)
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
    }
  }

  // Recalculate completePlays for modified albums and resolve missing tracklists
  for (const [albKey, alb] of Object.entries(albums)) {
    if (alb.totalTracks && alb.allTracks) {
      alb.completePlays = calculateCompletePlays(alb);
    } else if (alb.albumBrowseId) {
      ensureAlbumTracklist(albKey, alb.albumBrowseId);
    }
  }

  const storageUpdates = {
    totalPlays,
    songs,
    artists,
    albums
  };
  if (payload.newSyncState) {
    storageUpdates.historySyncState = payload.newSyncState;
  }

  await extBrowser.storage.local.set(storageUpdates);
  invalidateStatsCache();

  const singlesCount = Object.values(songs).filter(s => s.isSingle || !s.album).length;

  return {
    importedCount: newPlaysCount,
    totalPlays,
    uniqueSongs: Object.keys(songs).length,
    uniqueArtists: Object.keys(artists).length,
    uniqueAlbums: Object.keys(albums).length,
    singlesCount,
    historySyncState: payload.newSyncState || null
  };
}

/**
 * Returns detailed album data with listened tracks vs full album tracklist
 */
async function handleGetAlbumDetails(payload) {
  if (!payload || !payload.album) return null;
  const data = await extBrowser.storage.local.get(['albums']);
  const albums = cleanAlbumsDict(data.albums || {});
  const albumKey = makeAlbumKey(payload.album, payload.artist);
  let album = albums[albumKey];
  if (!album) {
    const matchKey = Object.keys(albums).find(k => k.toLowerCase() === albumKey.toLowerCase());
    if (matchKey) album = albums[matchKey];
  }
  if (!album) return null;

  // If album has albumBrowseId and allTracks is not yet populated, query YouTube Music
  if (album.albumBrowseId && (!album.allTracks || album.allTracks.length === 0)) {
    try {
      const fetched = await fetchAlbumTrackCount(album.albumBrowseId);
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
 * Recursively extracts track titles from YouTube Music browse results
 */
function extractTrackTitlesFromBrowse(node, titles = []) {
  if (!node || typeof node !== 'object') return titles;

  if (node.musicResponsiveListItemRenderer) {
    const renderer = node.musicResponsiveListItemRenderer;
    const flexCols = renderer.flexColumns || [];
    const titleCol = flexCols[0]?.musicResponsiveListItemFlexColumnRenderer?.title?.runs?.[0]?.text;
    if (titleCol && !titles.includes(titleCol.trim())) {
      titles.push(titleCol.trim());
    }
    return titles;
  }

  if (Array.isArray(node)) {
    for (const item of node) {
      extractTrackTitlesFromBrowse(item, titles);
    }
  } else {
    for (const key of Object.keys(node)) {
      if (key !== 'trackingParams' && key !== 'clickTrackingParams') {
        extractTrackTitlesFromBrowse(node[key], titles);
      }
    }
  }
  return titles;
}

/**
 * Queries YouTube Music's public browse endpoint to get album track count and tracklist
 */
async function fetchAlbumTrackCount(browseId) {
  if (!browseId) return null;
  const cleanId = browseId.startsWith('VL') ? browseId : (browseId.startsWith('OLAK5uy') ? `VL${browseId}` : browseId);
  try {
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
    if (!res.ok) return null;
    const json = await res.json();
    
    const trackTitles = extractTrackTitlesFromBrowse(json.contents);
    const coverUrl = findBestThumbnail(json);

    if (trackTitles.length > 0 || coverUrl) {
      return { totalTracks: trackTitles.length || null, trackTitles, coverUrl };
    }
    return null;
  } catch (err) {
    console.warn('[YTMusic Counter] Error fetching album metadata:', err);
    return null;
  }
}

function findBestThumbnail(obj) {
  if (!obj) return null;
  let bestUrl = null;
  let maxDim = 0;

  function traverse(node, depth = 0) {
    if (!node || depth > 15) return;
    if (typeof node !== 'object') return;

    if (typeof node.url === 'string' && (node.url.includes('googleusercontent.com') || node.url.includes('ggpht.com') || node.url.includes('ytimg.com'))) {
      const dim = (node.width || 1) * (node.height || 1);
      if (dim >= maxDim) {
        maxDim = dim;
        bestUrl = node.url;
      }
    }

    if (Array.isArray(node.thumbnails)) {
      for (const t of node.thumbnails) {
        if (t && typeof t.url === 'string') {
          const dim = (t.width || 1) * (t.height || 1);
          if (dim >= maxDim) {
            maxDim = dim;
            bestUrl = t.url;
          }
        }
      }
    }

    if (Array.isArray(node)) {
      for (const item of node) traverse(item, depth + 1);
    } else {
      for (const key of Object.keys(node)) {
        if (key === 'thumbnails') continue;
        traverse(node[key], depth + 1);
      }
    }
  }

  traverse(obj);

  if (bestUrl) {
    if (bestUrl.startsWith('//')) bestUrl = 'https:' + bestUrl;
    return bestUrl;
  }
  return null;
}

let googleSearchCooldownUntil = 0;

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
    console.warn('[YTMusic Counter] Cover Art Archive lookup error:', err);
  }
  return null;
}

async function resolveAlbumCover(album, artist, browseId) {
  let coverUrl = null;
  const cleanAlb = (album || '').replace(/\s*[\(\[].*?[\)\]]/g, '').trim();
  const cleanArt = (artist || '').split('•')[0].split(/[,&/]| feat/i)[0].trim();

  // Tier 1: Try YouTube Music Browse endpoint if browseId exists
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

  // Tier 2: Try YouTube Music Search endpoint (if not in cooldown)
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

  // Fallback search with album title only if still not throttled
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

  // Tier 3: Cover Art Archive / MusicBrainz Fallback
  if (!coverUrl && cleanAlb) {
    coverUrl = await fetchCoverFromCoverArtArchive(cleanAlb, cleanArt);
  }

  return coverUrl;
}

// Sequential queue for cover resolution (max 1 request at a time with 1.2s delay)
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
  const albums = cleanAlbumsDict(data.albums || {});

  if (albums[albumKey] && albums[albumKey].coverUrl) {
    return { coverUrl: albums[albumKey].coverUrl };
  }

  const browseId = payload.browseId || (albums[albumKey] && albums[albumKey].albumBrowseId);
  const coverUrl = await enqueueCoverRequest(albumName, artistName, browseId);

  if (coverUrl) {
    if (typeof thumbnailCache !== 'undefined' && thumbnailCache.cacheRemoteThumbnail) {
      thumbnailCache.cacheRemoteThumbnail(albumKey, coverUrl).catch(() => {});
    }
    const freshData = await extBrowser.storage.local.get(['albums']);
    const freshAlbums = cleanAlbumsDict(freshData.albums || {});
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
  const albums = cleanAlbumsDict(data.albums || {});
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
    console.log(`[YTMusic Counter] Backfilled ${updated} album covers from history.`);
  }

  return { updated };
}

// In-flight tracklist fetch requests deduplication
const pendingTracklistFetches = new Set();

/**
 * Asynchronously resolves album tracklist and recomputes cumulative completion
 */
async function ensureAlbumTracklist(albumKey, browseId) {
  if (!browseId || pendingTracklistFetches.has(albumKey)) return;
  pendingTracklistFetches.add(albumKey);

  try {
    const fetched = await fetchAlbumTrackCount(browseId);
    if (fetched) {
      const data = await extBrowser.storage.local.get(['albums']);
      const albums = cleanAlbumsDict(data.albums || {});
      if (albums[albumKey]) {
        let changed = false;
        if (fetched.totalTracks && fetched.trackTitles) {
          albums[albumKey].totalTracks = fetched.totalTracks;
          albums[albumKey].allTracks = fetched.trackTitles;
          albums[albumKey].completePlays = calculateCompletePlays(albums[albumKey]);
          changed = true;
        }
        if (fetched.coverUrl && !albums[albumKey].coverUrl) {
          albums[albumKey].coverUrl = fetched.coverUrl;
          changed = true;
        }
        if (changed) {
          await extBrowser.storage.local.set({ albums });
          invalidateStatsCache();
        }
      }
    }
  } catch (err) {
    console.warn('[YTMusic Counter] Error ensuring album tracklist for', albumKey, err);
  } finally {
    pendingTracklistFetches.delete(albumKey);
  }
}

