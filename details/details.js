/**
 * YTMusic Counter - Details & Config Script
 * Handles real-time statistics display, tab navigation,
 * and a 3-step confirmation flow for erasing all extension data.
 */

const extBrowser = typeof browser !== 'undefined' ? browser : chrome;

// DOM Elements Cache
const elements = {
  // Navigation
  tabBtnDetails: document.getElementById('tabBtnDetails'),
  tabBtnConfig: document.getElementById('tabBtnConfig'),
  detailsPanel: document.getElementById('detailsPanel'),
  configPanel: document.getElementById('configPanel'),

  // Stats in Details Panel
  totalSongsListened: document.getElementById('totalSongsListened'),
  uniqueSongsStat: document.getElementById('uniqueSongsStat'),
  uniqueArtistsStat: document.getElementById('uniqueArtistsStat'),
  completedAlbumsStat: document.getElementById('completedAlbumsStat'),
  activeTrackTitle: document.getElementById('activeTrackTitle'),
  activeTrackArtist: document.getElementById('activeTrackArtist'),

  // 3-Step Wipe Container & Views
  wipeStep0: document.getElementById('wipeStep0'),
  wipeStep1: document.getElementById('wipeStep1'),
  wipeStep2: document.getElementById('wipeStep2'),
  wipeStep3: document.getElementById('wipeStep3'),

  // Wipe Buttons
  initiateDeleteBtn: document.getElementById('initiateDeleteBtn'),
  cancelStep1Btn: document.getElementById('cancelStep1Btn'),
  confirmStep1Btn: document.getElementById('confirmStep1Btn'),
  cancelStep2Btn: document.getElementById('cancelStep2Btn'),
  confirmStep2Btn: document.getElementById('confirmStep2Btn'),
  cancelStep3Btn: document.getElementById('cancelStep3Btn'),
  confirmStep3Btn: document.getElementById('confirmStep3Btn'),

  // Success Feedback
  deleteSuccessAlert: document.getElementById('deleteSuccessAlert')
};

/* ==========================================================================
   Tab Navigation
   ========================================================================== */
function setupTabs() {
  const tabs = [
    { btn: elements.tabBtnDetails, panel: elements.detailsPanel },
    { btn: elements.tabBtnConfig, panel: elements.configPanel }
  ];

  tabs.forEach(({ btn, panel }) => {
    if (!btn || !panel) return;
    btn.addEventListener('click', () => {
      tabs.forEach(t => {
        t.btn.classList.remove('active');
        t.btn.setAttribute('aria-selected', 'false');
        t.panel.classList.remove('active');
      });

      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      panel.classList.add('active');
    });
  });
}

/* ==========================================================================
   Statistics Retrieval & Rendering
   ========================================================================== */
async function loadStats() {
  try {
    extBrowser.runtime.sendMessage({ type: 'GET_STATS' }, (response) => {
      if (extBrowser.runtime.lastError) {
        console.warn('[Details] Background communication error:', extBrowser.runtime.lastError);
        fetchStatsDirectlyFromStorage();
        return;
      }
      if (response && response.status === 'ok') {
        renderStats(response.data);
      } else {
        fetchStatsDirectlyFromStorage();
      }
    });
  } catch (err) {
    console.error('[Details] Error requesting stats:', err);
    fetchStatsDirectlyFromStorage();
  }
}

// Fallback to direct storage access if background messaging fails
async function fetchStatsDirectlyFromStorage() {
  try {
    const data = await extBrowser.storage.local.get(['totalPlays', 'songs', 'artists', 'albums', 'currentTrack']);
    const songs = data.songs || {};
    const artists = data.artists || {};
    const albums = data.albums || {};

    const compiledStats = {
      totalPlays: data.totalPlays || 0,
      uniqueSongsCount: Object.keys(songs).length,
      uniqueArtistsCount: Object.keys(artists).length,
      completedAlbumsCount: Object.values(albums).reduce((sum, a) => sum + (a.completePlays || 0), 0),
      currentTrack: data.currentTrack || null
    };
    renderStats(compiledStats);
  } catch (storageErr) {
    console.error('[Details] Storage fallback error:', storageErr);
  }
}

function renderStats(stats) {
  if (!stats) return;

  // Primary Row: Total Songs Listened
  if (elements.totalSongsListened) {
    const formattedCount = (stats.totalPlays || 0).toLocaleString();
    const prev = elements.totalSongsListened.textContent;
    if (prev !== formattedCount) {
      elements.totalSongsListened.textContent = formattedCount;
      elements.totalSongsListened.classList.add('bump');
      setTimeout(() => elements.totalSongsListened.classList.remove('bump'), 250);
    }
  }

  // Supporting metrics
  if (elements.uniqueSongsStat) {
    elements.uniqueSongsStat.textContent = (stats.uniqueSongsCount || 0).toLocaleString();
  }
  if (elements.uniqueArtistsStat) {
    elements.uniqueArtistsStat.textContent = (stats.uniqueArtistsCount || 0).toLocaleString();
  }
  if (elements.completedAlbumsStat) {
    elements.completedAlbumsStat.textContent = (stats.completedAlbumsCount || 0).toLocaleString();
  }

  // Active track info
  if (elements.activeTrackTitle && elements.activeTrackArtist) {
    if (stats.currentTrack && stats.currentTrack.title) {
      elements.activeTrackTitle.textContent = stats.currentTrack.title;
      elements.activeTrackArtist.textContent = [stats.currentTrack.artist, stats.currentTrack.album]
        .filter(Boolean)
        .join(' • ') + (stats.currentTrack.songPlays ? ` (${stats.currentTrack.songPlays} plays)` : '');
    } else {
      elements.activeTrackTitle.textContent = 'No track currently active';
      elements.activeTrackArtist.textContent = 'Listen to music on music.youtube.com';
    }
  }
}

/* ==========================================================================
   3-Step Confirmation Delete Flow
   ========================================================================== */
function setWipeStep(stepIndex) {
  const steps = [elements.wipeStep0, elements.wipeStep1, elements.wipeStep2, elements.wipeStep3];
  steps.forEach((step, idx) => {
    if (!step) return;
    if (idx === stepIndex) {
      step.classList.add('active');
    } else {
      step.classList.remove('active');
    }
  });
}

function setupWipeDataWorkflow() {
  // Step 0 -> Step 1
  if (elements.initiateDeleteBtn) {
    elements.initiateDeleteBtn.addEventListener('click', () => {
      hideSuccessAlert();
      setWipeStep(1);
    });
  }

  // Step 1: Cancel -> Step 0
  if (elements.cancelStep1Btn) {
    elements.cancelStep1Btn.addEventListener('click', () => {
      setWipeStep(0);
    });
  }

  // Step 1 -> Step 2 (First Confirmation)
  if (elements.confirmStep1Btn) {
    elements.confirmStep1Btn.addEventListener('click', () => {
      setWipeStep(2);
    });
  }

  // Step 2: Cancel -> Step 0
  if (elements.cancelStep2Btn) {
    elements.cancelStep2Btn.addEventListener('click', () => {
      setWipeStep(0);
    });
  }

  // Step 2 -> Step 3 (Second Confirmation)
  if (elements.confirmStep2Btn) {
    elements.confirmStep2Btn.addEventListener('click', () => {
      setWipeStep(3);
    });
  }

  // Step 3: Cancel -> Step 0
  if (elements.cancelStep3Btn) {
    elements.cancelStep3Btn.addEventListener('click', () => {
      setWipeStep(0);
    });
  }

  // Step 3 -> Execute Deletion (Third & Final Confirmation)
  if (elements.confirmStep3Btn) {
    elements.confirmStep3Btn.addEventListener('click', async () => {
      await executeDataWipe();
    });
  }
}

async function executeDataWipe() {
  try {
    // 1. Send reset message to background service
    extBrowser.runtime.sendMessage({ type: 'RESET_STATS' }, async (response) => {
      // Direct storage reset as foolproof fallback
      await extBrowser.storage.local.clear();
      await extBrowser.storage.local.set({
        totalPlays: 0,
        songs: {},
        artists: {},
        albums: {},
        currentTrack: null
      });

      // 2. Return UI to step 0
      setWipeStep(0);

      // 3. Show success alert
      showSuccessAlert();

      // 4. Reload stats immediately
      loadStats();
    });
  } catch (err) {
    console.error('[Details] Error during data wipe:', err);
    // Direct fallback
    await extBrowser.storage.local.clear();
    await extBrowser.storage.local.set({
      totalPlays: 0,
      songs: {},
      artists: {},
      albums: {},
      currentTrack: null
    });
    setWipeStep(0);
    showSuccessAlert();
    loadStats();
  }
}

function showSuccessAlert() {
  if (!elements.deleteSuccessAlert) return;
  elements.deleteSuccessAlert.style.display = 'flex';
  setTimeout(() => {
    hideSuccessAlert();
  }, 5000);
}

function hideSuccessAlert() {
  if (!elements.deleteSuccessAlert) return;
  elements.deleteSuccessAlert.style.display = 'none';
}

/* ==========================================================================
   Real-Time Storage Synchronization
   ========================================================================== */
if (extBrowser.storage && extBrowser.storage.onChanged) {
  extBrowser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local') {
      loadStats();
    }
  });
}

// Initialization on DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
  setupTabs();
  setupWipeDataWorkflow();
  loadStats();
});
