/**
 * YTMusic Counter - Background Script
 * Listens for events from content scripts and manages persistent storage.
 */

// Cross-browser compatibility alias
const extBrowser = typeof browser !== 'undefined' ? browser : chrome;

const DEFAULT_STATE = {
  totalPlays: 0,
  currentTrack: null,
  history: [],
  sessionStartTime: Date.now()
};

// Initialize extension storage with default values on installation or startup
async function initializeStorage() {
  try {
    const data = await extBrowser.storage.local.get(['totalPlays', 'history', 'sessionStartTime']);
    const updates = {};
    if (typeof data.totalPlays === 'undefined') updates.totalPlays = 0;
    if (!Array.isArray(data.history)) updates.history = [];
    if (!data.sessionStartTime) updates.sessionStartTime = Date.now();

    if (Object.keys(updates).length > 0) {
      await extBrowser.storage.local.set(updates);
    }
  } catch (err) {
    console.error('[YTMusic Counter Background] Storage init error:', err);
  }
}

initializeStorage();

// Handle messages from content script and popup
extBrowser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return;

  switch (message.type) {
    case 'TRACK_PLAYED': {
      handleTrackPlayed(message.payload)
        .then(updatedStats => sendResponse({ status: 'ok', data: updatedStats }))
        .catch(err => sendResponse({ status: 'error', error: err.message }));
      return true; // Keep message channel open for async response
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

async function handleTrackPlayed(track) {
  const current = await extBrowser.storage.local.get(['totalPlays', 'history']);
  const totalPlays = (current.totalPlays || 0) + 1;
  const history = current.history || [];

  const entry = {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    title: track.title || 'Unknown Title',
    artist: track.artist || 'Unknown Artist',
    album: track.album || '',
    timestamp: Date.now()
  };

  // Keep latest 100 tracks in history
  const updatedHistory = [entry, ...history].slice(0, 100);

  await extBrowser.storage.local.set({
    totalPlays,
    history: updatedHistory,
    currentTrack: entry
  });

  return { totalPlays, currentTrack: entry };
}

async function getStats() {
  const data = await extBrowser.storage.local.get(['totalPlays', 'history', 'currentTrack', 'sessionStartTime']);
  return {
    totalPlays: data.totalPlays || 0,
    currentTrack: data.currentTrack || null,
    recentHistory: (data.history || []).slice(0, 10),
    sessionStartTime: data.sessionStartTime || Date.now()
  };
}

async function resetStats() {
  const newState = {
    totalPlays: 0,
    history: [],
    currentTrack: null,
    sessionStartTime: Date.now()
  };
  await extBrowser.storage.local.set(newState);
  return newState;
}
