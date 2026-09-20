/**
 * YTMusic Counter - Popup Script
 * Handles real-time grouped stats rendering for Songs, Artists, and Completed Albums.
 */

const extBrowser = typeof browser !== 'undefined' ? browser : chrome;

const elements = {
  totalPlays: document.getElementById('totalPlays'),
  uniqueSongs: document.getElementById('uniqueSongs'),
  uniqueArtists: document.getElementById('uniqueArtists'),
  uniqueAlbums: document.getElementById('uniqueAlbums'),
  completedAlbums: document.getElementById('completedAlbums'),

  currentTrackTitle: document.getElementById('currentTrackTitle'),
  currentTrackArtist: document.getElementById('currentTrackArtist'),
  currentSongPlaysBadge: document.getElementById('currentSongPlaysBadge'),

  topSongsList: document.getElementById('topSongsList'),
  topArtistsList: document.getElementById('topArtistsList'),
  topAlbumsList: document.getElementById('topAlbumsList'),

  tabButtons: document.querySelectorAll('.tab-btn'),
  tabContents: document.querySelectorAll('.tab-content'),

  resetAllBtn: document.getElementById('resetAllBtn'),
  openYtMusicBtn: document.getElementById('openYtMusicBtn'),
  openDetailsBtn: document.getElementById('openDetailsBtn'),
  openDetailsFooterBtn: document.getElementById('openDetailsFooterBtn')
};

// Tab Switching
elements.tabButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    elements.tabButtons.forEach(b => b.classList.remove('active'));
    elements.tabContents.forEach(c => c.classList.remove('active'));

    btn.classList.add('active');
    const targetId = btn.getAttribute('data-tab');
    const targetContent = document.getElementById(targetId);
    if (targetContent) {
      targetContent.classList.add('active');
    }
  });
});

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

  // Hero Stats
  if (elements.totalPlays) {
    const prev = elements.totalPlays.textContent;
    const next = String(stats.totalPlays || 0);
    if (prev !== next) {
      elements.totalPlays.textContent = next;
      elements.totalPlays.classList.add('bump');
      setTimeout(() => elements.totalPlays.classList.remove('bump'), 200);
    }
  }

  if (elements.uniqueSongs) elements.uniqueSongs.textContent = stats.uniqueSongsCount || 0;
  if (elements.uniqueArtists) elements.uniqueArtists.textContent = stats.uniqueArtistsCount || 0;
  if (elements.uniqueAlbums) elements.uniqueAlbums.textContent = stats.uniqueAlbumsCount || 0;
  if (elements.completedAlbums) elements.completedAlbums.textContent = stats.completedAlbumsCount || 0;

  // Now Playing Card
  if (stats.currentTrack) {
    elements.currentTrackTitle.textContent = stats.currentTrack.title || 'Unknown Title';
    elements.currentTrackArtist.textContent = [stats.currentTrack.artist, stats.currentTrack.album].filter(Boolean).join(' • ');
    const songPlays = stats.currentTrack.songPlays || 0;
    elements.currentSongPlaysBadge.textContent = `${songPlays} ${songPlays === 1 ? 'play' : 'plays'}`;
  } else {
    elements.currentTrackTitle.textContent = 'No track playing';
    elements.currentTrackArtist.textContent = 'Open music.youtube.com';
    elements.currentSongPlaysBadge.textContent = '0 plays';
  }

  // Render Top Songs
  renderSongsList(stats.topSongs || []);

  // Render Top Artists
  renderArtistsList(stats.topArtists || []);

  // Render Completed Albums
  renderAlbumsList(stats.topAlbums || []);
}

function cleanArtist(artist) {
  if (!artist) return '';
  return String(artist).split('•')[0].trim();
}

function renderSongsList(items) {
  if (!elements.topSongsList) return;
  const top3 = (items || []).slice(0, 3);
  if (top3.length === 0) {
    elements.topSongsList.innerHTML = '<li class="empty-state">No songs tracked yet.</li>';
    return;
  }

  elements.topSongsList.innerHTML = '';
  top3.forEach((song, idx) => {
    const li = document.createElement('li');
    li.className = 'ranked-item';
    const displayArtist = cleanArtist(song.artist);
    li.innerHTML = `
      <div class="ranked-left">
        <span class="rank-index">#${idx + 1}</span>
        <div class="rank-text">
          <div class="rank-name" title="${escapeHtml(song.title)}">${escapeHtml(song.title)}</div>
          ${displayArtist ? `<span class="rank-sub" title="${escapeHtml(displayArtist)}">${escapeHtml(displayArtist)}</span>` : ''}
        </div>
      </div>
      <span class="rank-count">${song.playCount} ${song.playCount === 1 ? 'play' : 'plays'}</span>
    `;
    elements.topSongsList.appendChild(li);
  });
}

function renderArtistsList(items) {
  if (!elements.topArtistsList) return;
  const top3 = (items || []).slice(0, 3);
  if (top3.length === 0) {
    elements.topArtistsList.innerHTML = '<li class="empty-state">No artists tracked yet.</li>';
    return;
  }

  elements.topArtistsList.innerHTML = '';
  top3.forEach((artist, idx) => {
    const li = document.createElement('li');
    li.className = 'ranked-item';
    const displayArtist = cleanArtist(artist.artist);
    li.innerHTML = `
      <div class="ranked-left">
        <span class="rank-index">#${idx + 1}</span>
        <div class="rank-text">
          <div class="rank-name" title="${escapeHtml(displayArtist)}">${escapeHtml(displayArtist)}</div>
        </div>
      </div>
      <span class="rank-count">${artist.playCount} ${artist.playCount === 1 ? 'play' : 'plays'}</span>
    `;
    elements.topArtistsList.appendChild(li);
  });
}

function renderAlbumsList(items) {
  if (!elements.topAlbumsList) return;
  const top3 = (items || []).slice(0, 3);
  if (top3.length === 0) {
    elements.topAlbumsList.innerHTML = '<li class="empty-state">No albums tracked yet.</li>';
    return;
  }

  elements.topAlbumsList.innerHTML = '';
  top3.forEach((album, idx) => {
    const li = document.createElement('li');
    li.className = 'ranked-item';
    const uniqueTracks = album.uniqueTracksCount || (album.tracksListened ? Object.keys(album.tracksListened).length : 1);
    let playsLabel = '';
    if (album.completePlays > 0) {
      playsLabel = `★ Full (${album.completePlays}x) • ${album.playCount} ${album.playCount === 1 ? 'play' : 'plays'}`;
    } else {
      playsLabel = `${uniqueTracks} ${uniqueTracks === 1 ? 'song' : 'songs'} • ${album.playCount} ${album.playCount === 1 ? 'play' : 'plays'}`;
    }

    const cleanArtistName = cleanArtist(album.artist);
    const hasDistinctArtist = cleanArtistName && cleanArtistName.toLowerCase() !== (album.album || '').toLowerCase();

    li.innerHTML = `
      <div class="ranked-left">
        <span class="rank-index">#${idx + 1}</span>
        <div class="rank-text">
          <div class="rank-name" title="${escapeHtml(album.album)}">${escapeHtml(album.album)}</div>
          ${hasDistinctArtist ? `<span class="rank-sub" title="${escapeHtml(cleanArtistName)}">${escapeHtml(cleanArtistName)}</span>` : ''}
        </div>
      </div>
      <span class="rank-count">${playsLabel}</span>
    `;
    elements.topAlbumsList.appendChild(li);
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Reset stats button handler
if (elements.resetAllBtn) {
  elements.resetAllBtn.addEventListener('click', () => {
    if (confirm('Are you sure you want to reset all song, artist, and album statistics?')) {
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
        await extBrowser.tabs.update(tabs[0].id, { active: true });
        if (tabs[0].windowId) {
          await extBrowser.windows.update(tabs[0].windowId, { focused: true });
        }
      } else {
        await extBrowser.tabs.create({ url: ytMusicUrl });
      }
      window.close();
    } catch (err) {
      window.open(ytMusicUrl, '_blank');
    }
  });
}

// Open Details Page
function openDetailsPage() {
  const detailsUrl = extBrowser.runtime.getURL('details/details.html');
  try {
    extBrowser.tabs.create({ url: detailsUrl });
    window.close();
  } catch (err) {
    window.open(detailsUrl, '_blank');
  }
}

if (elements.openDetailsBtn) {
  elements.openDetailsBtn.addEventListener('click', openDetailsPage);
}

if (elements.openDetailsFooterBtn) {
  elements.openDetailsFooterBtn.addEventListener('click', openDetailsPage);
}

// Live sync with storage changes
if (extBrowser.storage && extBrowser.storage.onChanged) {
  extBrowser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local') {
      loadStats();
    }
  });
}

// Initial fetch
document.addEventListener('DOMContentLoaded', loadStats);
