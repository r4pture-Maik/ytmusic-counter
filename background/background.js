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

// Initialize default storage schema
async function initializeStorage() {
  try {
    const data = await extBrowser.storage.local.get(['totalPlays', 'songs', 'artists', 'albums']);
    const updates = {};
    if (typeof data.totalPlays === 'undefined') updates.totalPlays = 0;
    if (!data.songs || typeof data.songs !== 'object') updates.songs = {};
    if (!data.artists || typeof data.artists !== 'object') updates.artists = {};
    if (!data.albums || typeof data.albums !== 'object') updates.albums = {};

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

    case 'RESET_STATS': {
      resetStats()
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
async function handleTrackPlayed(track) {
  if (!track || !track.title) return { totalPlays: 0, songPlays: 0 };

  const data = await extBrowser.storage.local.get(['totalPlays', 'songs', 'artists']);
  const totalPlays = (data.totalPlays || 0) + 1;
  const songs = data.songs || {};
  const artists = data.artists || {};

  const songKey = makeSongKey(track.title, track.artist);
  const artistKey = makeArtistKey(track.artist);

  // Update Song count
  if (!songs[songKey]) {
    songs[songKey] = {
      title: track.title,
      artist: track.artist || 'Unknown Artist',
      album: track.album || '',
      playCount: 1
    };
  } else {
    songs[songKey].playCount = (songs[songKey].playCount || 0) + 1;
    if (track.album && !songs[songKey].album) songs[songKey].album = track.album;
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

  const currentTrack = {
    title: track.title,
    artist: track.artist || 'Unknown Artist',
    album: track.album || '',
    songPlays: songs[songKey].playCount
  };

  await extBrowser.storage.local.set({
    totalPlays,
    songs,
    artists,
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
  const albums = data.albums || {};
  const albumKey = makeAlbumKey(payload.album, payload.artist);

  if (!albums[albumKey]) {
    albums[albumKey] = {
      album: payload.album,
      artist: payload.artist || 'Unknown Artist',
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
  const albums = data.albums || {};

  // Sort top 20 items for each category
  const topSongs = Object.values(songs)
    .sort((a, b) => b.playCount - a.playCount)
    .slice(0, 20);

  const topArtists = Object.values(artists)
    .sort((a, b) => b.playCount - a.playCount)
    .slice(0, 20);

  const topAlbums = Object.values(albums)
    .sort((a, b) => b.completePlays - a.completePlays)
    .slice(0, 20);

  return {
    totalPlays: data.totalPlays || 0,
    currentTrack: data.currentTrack || null,
    uniqueSongsCount: Object.keys(songs).length,
    uniqueArtistsCount: Object.keys(artists).length,
    completedAlbumsCount: Object.values(albums).reduce((sum, a) => sum + (a.completePlays || 0), 0),
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
    currentTrack: null
  };
  await extBrowser.storage.local.clear();
  await extBrowser.storage.local.set(emptyState);
  return emptyState;
}
