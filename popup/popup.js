/**
 * YTMusic Counter - Popup Script
 * Handles UI updates and interactions inside the extension popup.
 */

const extBrowser = typeof browser !== 'undefined' ? browser : chrome;

const elements = {
  totalPlays: document.getElementById('totalPlays'),
  currentTrackTitle: document.getElementById('currentTrackTitle'),
  currentTrackArtist: document.getElementById('currentTrackArtist'),
  livePill: document.getElementById('livePill'),
  historyList: document.getElementById('historyList'),
  clearHistoryBtn: document.getElementById('clearHistoryBtn'),
  openYtMusicBtn: document.getElementById('openYtMusicBtn')
};

async function loadStats() {
  try {
    extBrowser.runtime.sendMessage({ type: 'GET_STATS' }, (response) => {
      if (extBrowser.runtime.lastError) {
        console.warn('Could not communicate with background script:', extBrowser.runtime.lastError);
        return;
      }
      if (response && response.status === 'ok') {
        renderStats(response.data);
      }
    });
  } catch (err) {
    console.error('Error loading stats:', err);
  }
}

function renderStats(stats) {
  if (!stats) return;

  // Render Total Plays
  if (elements.totalPlays) {
    const prev = elements.totalPlays.textContent;
    const next = String(stats.totalPlays || 0);
    if (prev !== next) {
      elements.totalPlays.textContent = next;
      elements.totalPlays.classList.add('bump');
      setTimeout(() => elements.totalPlays.classList.remove('bump'), 200);
    }
  }

  // Render Current Track
  if (stats.currentTrack) {
    elements.currentTrackTitle.textContent = stats.currentTrack.title || 'Unknown Title';
    elements.currentTrackArtist.textContent = stats.currentTrack.artist || 'Unknown Artist';
    elements.livePill.textContent = 'Active';
    elements.livePill.classList.add('active');
  } else {
    elements.currentTrackTitle.textContent = 'No track playing';
    elements.currentTrackArtist.textContent = 'Open music.youtube.com';
    elements.livePill.textContent = 'Idle';
    elements.livePill.classList.remove('active');
  }

  // Render History List
  renderHistory(stats.recentHistory || []);
}

function renderHistory(items) {
  if (!elements.historyList) return;

  if (items.length === 0) {
    elements.historyList.innerHTML = '<li class="empty-state">No songs counted yet. Start listening on YouTube Music!</li>';
    return;
  }

  elements.historyList.innerHTML = '';
  items.forEach(item => {
    const li = document.createElement('li');
    li.className = 'history-item';

    const titleSpan = document.createElement('span');
    titleSpan.className = 'history-item-title';
    titleSpan.textContent = `${item.title} • ${item.artist}`;
    titleSpan.title = `${item.title} - ${item.artist}`;

    const timeSpan = document.createElement('span');
    timeSpan.className = 'history-item-time';
    timeSpan.textContent = formatTimestamp(item.timestamp);

    li.appendChild(titleSpan);
    li.appendChild(timeSpan);
    elements.historyList.appendChild(li);
  });
}

function formatTimestamp(ts) {
  if (!ts) return '';
  const date = new Date(ts);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Reset stats button handler
if (elements.clearHistoryBtn) {
  elements.clearHistoryBtn.addEventListener('click', () => {
    if (confirm('Reset play count and history?')) {
      extBrowser.runtime.sendMessage({ type: 'RESET_STATS' }, (response) => {
        if (response && response.status === 'ok') {
          loadStats();
        }
      });
    }
  });
}

// Open / Focus YouTube Music tab
if (elements.openYtMusicBtn) {
  elements.openYtMusicBtn.addEventListener('click', async () => {
    const ytMusicUrl = 'https://music.youtube.com/';
    try {
      const tabs = await extBrowser.tabs.query({ url: '*://music.youtube.com/*' });
      if (tabs.length > 0) {
        // Focus existing tab
        await extBrowser.tabs.update(tabs[0].id, { active: true });
        if (tabs[0].windowId) {
          await extBrowser.windows.update(tabs[0].windowId, { focused: true });
        }
      } else {
        // Open new tab
        await extBrowser.tabs.create({ url: ytMusicUrl });
      }
      window.close();
    } catch (err) {
      window.open(ytMusicUrl, '_blank');
    }
  });
}

// Listen for storage changes to update live
if (extBrowser.storage && extBrowser.storage.onChanged) {
  extBrowser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local') {
      loadStats();
    }
  });
}

// Initial fetch
document.addEventListener('DOMContentLoaded', loadStats);
