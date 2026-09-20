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
      cleanAlbums[cleanAlbKey].completePlays = (cleanAlbums[cleanAlbKey].completePlays || 0) + (alb.completePlays || 0);
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
      }
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
  const album = albums[albumKey];
  if (!album) return null;

  // If album has albumBrowseId and totalTracks is not yet known, query YouTube Music
  if (album.albumBrowseId && !album.totalTracks) {
    try {
      const fetched = await fetchAlbumTrackCount(album.albumBrowseId);
      if (fetched && fetched.totalTracks) {
        album.totalTracks = fetched.totalTracks;
        album.allTracks = fetched.trackTitles || [];
        if (album.uniqueTracksCount >= album.totalTracks && album.totalTracks > 1) {
          if (!album.completePlays) album.completePlays = 1;
        }
        albums[albumKey] = album;
        await extBrowser.storage.local.set({ albums });
        invalidateStatsCache();
      }
    } catch (_) {}
  }

  return album;
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
    
    const trackTitles = [];
    const tabs = json.contents?.twoColumnBrowseResultsRenderer?.tabs || [];
    const tabContents = tabs[0]?.tabRenderer?.content?.sectionListRenderer?.contents || [];
    for (const section of tabContents) {
      const shelf = section.musicShelfRenderer || section.musicPlaylistShelfRenderer;
      if (shelf && shelf.contents) {
        for (const item of shelf.contents) {
          const renderer = item.musicResponsiveListItemRenderer;
          if (renderer) {
            const flexCols = renderer.flexColumns || [];
            const titleCol = flexCols[0]?.musicResponsiveListItemFlexColumnRenderer?.title?.runs?.[0]?.text;
            if (titleCol) trackTitles.push(titleCol.trim());
          }
        }
      }
    }

    if (trackTitles.length > 0) {
      return { totalTracks: trackTitles.length, trackTitles };
    }
    return null;
  } catch (err) {
    console.warn('[YTMusic Counter] Error fetching album metadata:', err);
    return null;
  }
}

