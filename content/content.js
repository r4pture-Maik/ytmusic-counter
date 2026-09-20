/**
 * YTMusic Counter - Content Script
 * Injected into music.youtube.com to detect song playback and notify background script.
 */

(function () {
  const extBrowser = typeof browser !== 'undefined' ? browser : chrome;

  let lastTrackKey = null;
  let trackStartTime = 0;
  const MIN_PLAY_TIME_MS = 5000; // Minimum duration to count track as listened (prevents rapid skipping)

  console.log('[YTMusic Counter] Content script loaded on music.youtube.com');

  /**
   * Reads the current track metadata from the DOM player bar
   */
  function getCurrentTrackInfo() {
    const titleElem = document.querySelector('ytmusic-player-bar .title');
    const bylineElem = document.querySelector('ytmusic-player-bar .byline');

    if (!titleElem) {
      // Fallback to mediaSession or document.title
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
      const parts = Array.from(bylineElem.querySelectorAll('a')).map(a => a.textContent.trim());
      if (parts.length > 0) artist = parts[0];
      if (parts.length > 1) album = parts[1];
      if (!artist && bylineElem.textContent) {
        artist = bylineElem.textContent.split('•')[0].trim();
      }
    }

    return { title, artist, album };
  }

  /**
   * Checks if audio is currently playing
   */
  function isPlaying() {
    const playPauseBtn = document.querySelector('#play-pause-button');
    if (playPauseBtn) {
      const ariaLabel = playPauseBtn.getAttribute('aria-label') || '';
      const title = playPauseBtn.getAttribute('title') || '';
      // In YouTube Music, when music is playing, button typically shows "Pause" / "Metti in pausa"
      if (/pause/i.test(ariaLabel) || /pause/i.test(title)) {
        return true;
      }
    }

    // Secondary check: HTML5 video / audio elements
    const video = document.querySelector('video');
    if (video && !video.paused && !video.ended) {
      return true;
    }

    return false;
  }

  /**
   * Evaluates current track state and notifies background if a new play occurs
   */
  function checkTrackChange() {
    const track = getCurrentTrackInfo();
    if (!track || !track.title) return;

    const currentKey = `${track.title} - ${track.artist}`;

    if (currentKey !== lastTrackKey) {
      // Track has changed
      lastTrackKey = currentKey;
      trackStartTime = Date.now();

      // Notify background after minimum playback time if still playing the same song
      setTimeout(() => {
        if (lastTrackKey === currentKey && isPlaying()) {
          notifyTrackPlayed(track);
        }
      }, MIN_PLAY_TIME_MS);
    }
  }

  function notifyTrackPlayed(track) {
    try {
      extBrowser.runtime.sendMessage({
        type: 'TRACK_PLAYED',
        payload: track
      }, (response) => {
        if (extBrowser.runtime.lastError) {
          // Extension might have been reloaded
          return;
        }
        if (response && response.status === 'ok') {
          console.log('[YTMusic Counter] Counted play:', track.title, 'Total plays:', response.data.totalPlays);
          updateOnPageBadge(response.data.totalPlays);
        }
      });
    } catch (err) {
      console.warn('[YTMusic Counter] Error sending message to background:', err);
    }
  }

  /**
   * Creates or updates a subtle counter badge in the player bar UI
   */
  function updateOnPageBadge(count) {
    let badge = document.getElementById('ytmusic-counter-badge');
    if (!badge) {
      const rightControls = document.querySelector('ytmusic-player-bar .right-controls-buttons');
      if (!rightControls) return;

      badge = document.createElement('div');
      badge.id = 'ytmusic-counter-badge';
      badge.title = 'YTMusic Counter: Songs played in total';
      rightControls.prepend(badge);
    }
    badge.innerHTML = `<span class="ytmc-icon">🎵</span> <span class="ytmc-count">${count}</span>`;
  }

  // Set up mutation observer to detect song title changes in DOM
  const observer = new MutationObserver(() => {
    checkTrackChange();
  });

  function startObserver() {
    const target = document.querySelector('ytmusic-player-bar') || document.body;
    if (target) {
      observer.observe(target, {
        childList: true,
        subtree: true,
        characterData: true
      });
      // Initial check
      checkTrackChange();
    } else {
      setTimeout(startObserver, 1000);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserver);
  } else {
    startObserver();
  }
})();
