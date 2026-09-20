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

    if (bylineElem) {
      const links = Array.from(bylineElem.querySelectorAll('a')).map(a => a.textContent.trim());
      if (links.length > 0) artist = links[0];
      if (links.length > 1) album = links[1];

      // Fallback parse by bullets
      if (!artist && bylineElem.textContent) {
        const parts = bylineElem.textContent.split('•').map(p => p.trim());
        if (parts[0]) artist = parts[0];
        if (parts[1]) album = parts[1];
      }
    }

    return { title, artist, album };
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

  // Setup MutationObserver
  const observer = new MutationObserver(() => {
    checkTrackChange();
  });

  function init() {
    const target = document.querySelector('ytmusic-player-bar') || document.body;
    if (target) {
      observer.observe(target, { childList: true, subtree: true, characterData: true });
      checkTrackChange();
    } else {
      setTimeout(init, 800);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
