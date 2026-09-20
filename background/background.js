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

// Initialize default storage schema
async function initializeStorage() {
  try {
    const data = await extBrowser.storage.local.get(['totalPlays', 'songs', 'artists', 'albums']);
    const updates = {};
    if (typeof data.totalPlays === 'undefined') updates.totalPlays = 0;
    if (!data.songs || typeof data.songs !== 'object') updates.songs = {};
    if (!data.artists || typeof data.artists !== 'object') updates.artists = {};
    if (!data.albums || typeof data.albums !== 'object') {
      updates.albums = {};
    } else {
      const cleaned = cleanAlbumsDict(data.albums);
      if (Object.keys(cleaned).length !== Object.keys(data.albums).length) {
        updates.albums = cleaned;
      }
    }
    if (typeof data.historySyncState === 'undefined') updates.historySyncState = null;

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
async function handleTrackPlayed(track) {
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

  await extBrowser.storage.local.set({
    totalPlays,
    songs,
    artists,
    albums,
    currentTrack
  });

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
  console.log('[YTMusic Counter] Album completed:', payload.album, 'Total completions:', albums[albumKey].completePlays);
  return { completePlays: albums[albumKey].completePlays };
}

/**
 * Compiles aggregated statistics for popup display
 */
async function getStats() {
  const data = await extBrowser.storage.local.get(['totalPlays', 'songs', 'artists', 'albums', 'currentTrack']);
  const songs = data.songs || {};
  const artists = data.artists || {};
  const albums = cleanAlbumsDict(data.albums || {});

  // Sort top items for each category
  const topSongs = Object.values(songs)
    .sort((a, b) => b.playCount - a.playCount)
    .slice(0, 25);

  const topArtists = Object.values(artists)
    .sort((a, b) => b.playCount - a.playCount)
    .slice(0, 25);

  const topAlbums = Object.values(albums)
    .sort((a, b) => {
      const aScore = (a.completePlays || 0) * 100 + (a.playCount || 0);
      const bScore = (b.completePlays || 0) * 100 + (b.playCount || 0);
      return bScore - aScore;
    })
    .slice(0, 50);

  const singlesCount = Object.values(songs).filter(s => s.isSingle || !s.album).length;
  const completedAlbumsCount = Object.values(albums).reduce((sum, a) => sum + (a.completePlays || 0), 0);

  return {
    totalPlays: data.totalPlays || 0,
    currentTrack: data.currentTrack || null,
    uniqueSongsCount: Object.keys(songs).length,
    uniqueArtistsCount: Object.keys(artists).length,
    uniqueAlbumsCount: Object.keys(albums).length,
    singlesCount,
    completedAlbumsCount,
    topSongs,
    topArtists,
    topAlbums
  };
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

  for (const track of tracks) {
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

