/**
 * YTMusic Counter - Duration Tracking Module
 * Accumulates continuous playback time across global metrics, songs, artists, and albums.
 */

import { makeSongKey, makeArtistKey, makeAlbumKey } from './storage.js';

/**
 * Formats a duration in seconds into a human-readable display string.
 * Examples:
 * - 0s -> "0 min"
 * - 45s -> "< 1 min"
 * - 120s -> "2 mins"
 * - 3665s -> "1 hr 1 min"
 * - 52080s -> "14 hrs 28 mins"
 *
 * @param {number} totalSeconds
 * @returns {string}
 */
export function formatDuration(totalSeconds) {
  const sec = Math.max(0, Math.floor(totalSeconds || 0));
  if (sec === 0) return '0 min';
  if (sec < 60) return '< 1 min';

  const totalMinutes = Math.floor(sec / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) {
    return `${minutes} ${minutes === 1 ? 'min' : 'mins'}`;
  }

  const hrStr = `${hours} ${hours === 1 ? 'hr' : 'hrs'}`;
  if (minutes === 0) {
    return hrStr;
  }
  const minStr = `${minutes} ${minutes === 1 ? 'min' : 'mins'}`;
  return `${hrStr} ${minStr}`;
}

/**
 * Records a listening duration tick (delta) and updates storage.
 *
 * @param {object} payload
 * @param {string} payload.songTitle
 * @param {string} payload.songArtist
 * @param {string} [payload.songAlbum]
 * @param {boolean} [payload.isSingle]
 * @param {number} payload.deltaSeconds
 * @param {object} extBrowser
 * @param {Function} [invalidateCacheFn]
 * @returns {Promise<{ totalListeningSeconds: number, songDuration: number }>}
 */
export async function recordListeningDuration(payload, extBrowser, invalidateCacheFn = null) {
  if (!payload || !payload.songTitle) {
    return { totalListeningSeconds: 0, songDuration: 0 };
  }

  const delta = Math.max(0, Math.round(payload.deltaSeconds || 0));
  if (delta <= 0) {
    return { totalListeningSeconds: 0, songDuration: 0 };
  }

  if (!extBrowser || !extBrowser.storage || !extBrowser.storage.local) {
    return { totalListeningSeconds: delta, songDuration: delta };
  }

  const data = await extBrowser.storage.local.get([
    'totalListeningSeconds',
    'songs',
    'artists',
    'albums'
  ]);

  const totalListeningSeconds = (data.totalListeningSeconds || 0) + delta;
  const songs = data.songs || {};
  const artists = data.artists || {};
  const albums = data.albums || {};

  const title = (payload.songTitle || '').trim();
  const artist = (payload.songArtist || '').trim();
  const album = (payload.songAlbum || '').trim();
  const isSingle = Boolean(payload.isSingle || !album || /^single(\s*-\s*ep)?$/i.test(album) || /^ep$/i.test(album));

  // 1. Update Song duration
  const songKey = makeSongKey(title, artist);
  if (songs[songKey]) {
    songs[songKey].durationSeconds = (songs[songKey].durationSeconds || 0) + delta;
  } else {
    songs[songKey] = {
      title,
      artist: artist || 'Unknown Artist',
      album: isSingle ? '' : album,
      isSingle,
      playCount: 1,
      durationSeconds: delta
    };
  }
  const songDuration = songs[songKey].durationSeconds;

  // 2. Update Artists duration
  if (artist) {
    const artistList = artist.split(/[,&/]| feat\.? | ft\.? /i).map(a => a.trim()).filter(Boolean);
    artistList.forEach(rawName => {
      const aKey = makeArtistKey(rawName);
      if (artists[aKey]) {
        artists[aKey].durationSeconds = (artists[aKey].durationSeconds || 0) + delta;
      } else {
        artists[aKey] = {
          artist: rawName,
          playCount: 1,
          durationSeconds: delta
        };
      }
    });
  }

  // 3. Update Album duration (if not single)
  if (album && !isSingle) {
    const albumKey = makeAlbumKey(album, artist);
    if (albums[albumKey]) {
      albums[albumKey].durationSeconds = (albums[albumKey].durationSeconds || 0) + delta;
    }
  }

  await extBrowser.storage.local.set({
    totalListeningSeconds,
    songs,
    artists,
    albums
  });

  if (typeof invalidateCacheFn === 'function') {
    invalidateCacheFn();
  }

  return {
    totalListeningSeconds,
    songDuration
  };
}
