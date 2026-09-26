import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { formatDuration, recordListeningDuration } from '../background/duration.js';

describe('Duration Module - formatDuration', () => {
  test('formats zero and sub-minute durations', () => {
    assert.equal(formatDuration(0), '0 min');
    assert.equal(formatDuration(-10), '0 min');
    assert.equal(formatDuration(30), '< 1 min');
    assert.equal(formatDuration(59), '< 1 min');
  });

  test('formats minutes only', () => {
    assert.equal(formatDuration(60), '1 min');
    assert.equal(formatDuration(120), '2 mins');
    assert.equal(formatDuration(2700), '45 mins');
    assert.equal(formatDuration(3540), '59 mins');
  });

  test('formats hours and minutes', () => {
    assert.equal(formatDuration(3600), '1 hr');
    assert.equal(formatDuration(3660), '1 hr 1 min');
    assert.equal(formatDuration(7200), '2 hrs');
    assert.equal(formatDuration(7320), '2 hrs 2 mins');
    assert.equal(formatDuration(52080), '14 hrs 28 mins');
  });
});

describe('Duration Module - recordListeningDuration', () => {
  test('accumulates duration into mock storage', async () => {
    const memoryStorage = {
      totalListeningSeconds: 10,
      songs: {
        'test song:::test artist': {
          title: 'Test Song',
          artist: 'Test Artist',
          album: 'Test Album',
          playCount: 1,
          durationSeconds: 10
        }
      },
      artists: {
        'test artist': {
          artist: 'Test Artist',
          playCount: 1,
          durationSeconds: 10
        }
      },
      albums: {
        'test album:::test artist': {
          album: 'Test Album',
          artist: 'Test Artist',
          playCount: 1,
          durationSeconds: 10
        }
      }
    };

    const mockBrowser = {
      storage: {
        local: {
          get: async () => structuredClone(memoryStorage),
          set: async (updates) => {
            Object.assign(memoryStorage, updates);
          }
        }
      }
    };

    let cacheInvalidated = false;
    const result = await recordListeningDuration(
      {
        songTitle: 'Test Song',
        songArtist: 'Test Artist',
        songAlbum: 'Test Album',
        isSingle: false,
        deltaSeconds: 5
      },
      mockBrowser,
      () => { cacheInvalidated = true; }
    );

    assert.equal(result.totalListeningSeconds, 15);
    assert.equal(result.songDuration, 15);
    assert.equal(memoryStorage.totalListeningSeconds, 15);
    assert.equal(memoryStorage.songs['test song:::test artist'].durationSeconds, 15);
    assert.equal(memoryStorage.artists['test artist'].durationSeconds, 15);
    assert.equal(memoryStorage.albums['test album:::test artist'].durationSeconds, 15);
    assert.ok(cacheInvalidated);
  });
});
