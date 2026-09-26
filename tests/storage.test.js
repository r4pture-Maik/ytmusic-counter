import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeSongKey,
  makeArtistKey,
  makeAlbumKey,
  normalizeTrack,
  sanitizeStorageData
} from '../background/storage.js';

describe('Storage Module - Key Helpers', () => {
  test('creates consistent lowercase trimmed keys', () => {
    assert.equal(makeSongKey(' Song Name ', ' Queen '), 'song name:::queen');
    assert.equal(makeArtistKey(' Queen '), 'queen');
    assert.equal(makeAlbumKey(' A Night at the Opera ', ' Queen '), 'a night at the opera:::queen');
  });
});

describe('Storage Module - normalizeTrack', () => {
  test('splits bullet-separated artist and album', () => {
    const raw = {
      title: 'Bohemian Rhapsody',
      artist: 'Queen • A Night at the Opera'
    };
    const normalized = normalizeTrack(raw);
    assert.equal(normalized.artist, 'Queen');
    assert.equal(normalized.album, 'A Night at the Opera');
    assert.equal(normalized.isSingle, false);
  });

  test('marks track as single if album is single or ep', () => {
    const raw = {
      title: 'Single Song',
      artist: 'Band',
      album: 'Single'
    };
    const normalized = normalizeTrack(raw);
    assert.equal(normalized.album, '');
    assert.equal(normalized.isSingle, true);
  });

  test('detects identical artist and album as single', () => {
    const raw = {
      title: 'Track One',
      artist: 'ArtistName',
      album: 'ArtistName'
    };
    const normalized = normalizeTrack(raw);
    assert.equal(normalized.album, '');
    assert.equal(normalized.isSingle, true);
  });

  test('preserves durationSeconds on track', () => {
    const raw = {
      title: 'Long Song',
      artist: 'Band',
      album: 'Album',
      durationSeconds: 345
    };
    const normalized = normalizeTrack(raw);
    assert.equal(normalized.durationSeconds, 345);
  });
});

describe('Storage Module - sanitizeStorageData', () => {
  test('deduplicates and rebuilds artists list splitting multiple artists', () => {
    const rawData = {
      songs: {
        'song 1:::daft punk feat. pharrell williams': {
          title: 'Song 1',
          artist: 'Daft Punk feat. Pharrell Williams',
          album: 'Random Access Memories',
          playCount: 4,
          durationSeconds: 960
        }
      },
      albums: {
        'random access memories:::daft punk': {
          album: 'Random Access Memories',
          artist: 'Daft Punk',
          playCount: 4,
          durationSeconds: 960
        }
      }
    };

    const sanitized = sanitizeStorageData(rawData);
    assert.ok(sanitized.modified);
    assert.ok(sanitized.artists['daft punk']);
    assert.ok(sanitized.artists['pharrell williams']);
    assert.equal(sanitized.artists['daft punk'].playCount, 4);
    assert.equal(sanitized.artists['pharrell williams'].playCount, 4);
    assert.equal(sanitized.artists['daft punk'].durationSeconds, 960);
  });
});
