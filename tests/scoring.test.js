import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeTrackTitle,
  matchTrackPlayCount,
  calculateCompletePlays,
  cleanAlbumsDict
} from '../background/scoring.js';

describe('Scoring Engine - normalizeTrackTitle', () => {
  test('normalizes unicode smart quotes and dashes', () => {
    assert.equal(normalizeTrackTitle('Don’t Stop Believin’'), "don't stop believin'");
    assert.equal(normalizeTrackTitle('Rock ‘n’ Roll'), "rock 'n' roll");
    assert.equal(normalizeTrackTitle('“Heroes”'), 'heroes');
    assert.equal(normalizeTrackTitle('Song – Radio Edit'), 'song radio edit');
    assert.equal(normalizeTrackTitle('Wait… What?'), 'wait what');
  });

  test('strips remaster and edition tags', () => {
    assert.equal(normalizeTrackTitle('Paranoid (Remastered)'), 'paranoid');
    assert.equal(normalizeTrackTitle('Paranoid (Remastered 2020)'), 'paranoid');
    assert.equal(normalizeTrackTitle('Hotel California [2013 Remaster]'), 'hotel california');
    assert.equal(normalizeTrackTitle('In the End - 2020 Remaster'), 'in the end');
    assert.equal(normalizeTrackTitle('Something (Deluxe Edition)'), 'something');
    assert.equal(normalizeTrackTitle('Numb (Live at Milton Keynes)'), 'numb');
    assert.equal(normalizeTrackTitle('Bonus Jam [Bonus Track]'), 'bonus jam');
  });

  test('strips featured artists', () => {
    assert.equal(normalizeTrackTitle('Empire State of Mind (feat. Alicia Keys)'), 'empire state of mind');
    assert.equal(normalizeTrackTitle('Levitating [ft. DaBaby]'), 'levitating');
    assert.equal(normalizeTrackTitle('Song (featuring Artist)'), 'song');
  });

  test('collapses extraneous whitespace and non-letter noise', () => {
    assert.equal(normalizeTrackTitle('  Track   #1  (Explicit)  '), 'track 1');
  });
});

describe('Scoring Engine - matchTrackPlayCount', () => {
  const listenedDict = {
    'Bohemian Rhapsody': 5,
    'under pressure': 3,
    'Another One Bites the Dust (Remastered)': 4,
    'Radio Ga Ga (Official Single Version)': 2
  };

  test('matches exact track title', () => {
    assert.equal(matchTrackPlayCount('Bohemian Rhapsody', listenedDict), 5);
  });

  test('matches case-insensitive track title', () => {
    assert.equal(matchTrackPlayCount('BOHEMIAN RHAPSODY', listenedDict), 5);
    assert.equal(matchTrackPlayCount('Under Pressure', listenedDict), 3);
  });

  test('matches normalized track title', () => {
    // Official tracklist has clean title, user listened to remastered version
    assert.equal(matchTrackPlayCount('Another One Bites the Dust', listenedDict), 4);
    // User listened to clean title, official tracklist has remastered tag
    assert.equal(matchTrackPlayCount('Under Pressure - 2011 Remaster', listenedDict), 3);
  });

  test('does not match substrings like "Run" or "One" to avoid false positives', () => {
    const testListened = {
      'Running Fast': 5,
      'One More Light': 4
    };
    assert.equal(matchTrackPlayCount('Run', testListened), 0);
    assert.equal(matchTrackPlayCount('One', testListened), 0);
  });

  test('returns 0 when track is not in listened dictionary', () => {
    assert.equal(matchTrackPlayCount('We Will Rock You', listenedDict), 0);
    assert.equal(matchTrackPlayCount('', listenedDict), 0);
    assert.equal(matchTrackPlayCount('Song', null), 0);
  });
});

describe('Scoring Engine - calculateCompletePlays', () => {
  test('returns 0 for missing, empty, or album without allTracks', () => {
    assert.equal(calculateCompletePlays(null), 0);
    assert.equal(calculateCompletePlays({ totalTracks: 1 }), 0);
    assert.equal(calculateCompletePlays({ allTracks: [] }), 0);
    assert.equal(calculateCompletePlays({ totalTracks: 10, tracksListened: { 'Track 1': 1 } }), 0);
  });

  test('returns 0 if even 1 track is missing (0 plays), with zero tolerance', () => {
    const album10 = {
      totalTracks: 10,
      allTracks: Array.from({ length: 10 }, (_, i) => `Track ${i + 1}`),
      tracksListened: {
        'Track 1': 3,
        'Track 2': 3,
        'Track 3': 3,
        'Track 4': 3,
        'Track 5': 3,
        'Track 6': 3,
        'Track 7': 3,
        'Track 8': 3,
        'Track 9': 3
        // Track 10 missing
      },
      completePlays: 0
    };
    assert.equal(calculateCompletePlays(album10), 0);
  });

  test('returns 1 when all tracks have at least 1 play', () => {
    const album = {
      totalTracks: 4,
      allTracks: ['Track 1', 'Track 2', 'Track 3', 'Track 4'],
      tracksListened: {
        'Track 1': 1,
        'Track 2': 2,
        'Track 3': 1,
        'Track 4': 3
      }
    };
    assert.equal(calculateCompletePlays(album), 1);
  });

  test('returns 2 when all tracks have at least 2 plays', () => {
    const album = {
      totalTracks: 4,
      allTracks: ['Track 1', 'Track 2', 'Track 3', 'Track 4'],
      tracksListened: {
        'Track 1': 2,
        'Track 2': 3,
        'Track 3': 2,
        'Track 4': 5
      }
    };
    assert.equal(calculateCompletePlays(album), 2);
  });

  test('returns 0 when album has no allTracks even if tracksListened has tracks', () => {
    const unindexedAlbum = {
      totalTracks: 10,
      allTracks: [],
      tracksListened: {
        'Song A': 1, 'Song B': 1, 'Song C': 1, 'Song D': 1, 'Song E': 1,
        'Song F': 1, 'Song G': 1, 'Song H': 1, 'Song I': 1, 'Song J': 1
      },
      uniqueTracksCount: 10,
      completePlays: 0
    };
    assert.equal(calculateCompletePlays(unindexedAlbum), 0);
  });
});

describe('Scoring Engine - cleanAlbumsDict', () => {
  test('discards singles, single-ep, and numeric fake albums', () => {
    const raw = {
      'single:::artist': { album: 'Single', artist: 'Artist' },
      'single - ep:::artist': { album: 'Single - EP', artist: 'Artist' },
      'ep:::artist': { album: 'EP', artist: 'Artist' },
      'real album:::artist': {
        album: 'Real Album',
        artist: 'Artist',
        totalTracks: 8,
        tracksListened: { 'Song 1': 2 },
        completePlays: 0
      }
    };

    const cleaned = cleanAlbumsDict(raw);
    assert.equal(Object.keys(cleaned).length, 1);
    assert.ok(cleaned['real album:::artist']);
  });

  test('self-heals completePlays count', () => {
    const albumWithDrift = {
      'greatest hits:::queen': {
        album: 'Greatest Hits',
        artist: 'Queen',
        totalTracks: 3,
        allTracks: ['Track 1', 'Track 2', 'Track 3'],
        tracksListened: { 'Track 1': 2, 'Track 2': 2, 'Track 3': 2 },
        completePlays: 0 // drift: should be 2
      }
    };

    const cleaned = cleanAlbumsDict(albumWithDrift);
    assert.equal(cleaned['greatest hits:::queen'].completePlays, 2);
  });

  test('recomputes completePlays for imported album when all tracks have >= 1 play', () => {
    const importedAlbum = {
      'hybrid theory:::linkin park': {
        album: 'Hybrid Theory',
        artist: 'Linkin Park',
        totalTracks: null, // imported without totalTracks initially
        allTracks: ['Papercut', 'One Step Closer', 'With You', 'Points of Authority', 'Crawling', 'Runaway', 'By Myself', 'In the End', 'A Place for My Head', 'Forgotten', 'Cure for the Itch', 'Pushing Me Away'],
        tracksListened: {
          '01. Papercut': 1,
          'One Step Closer (Official Video)': 2,
          'With You': 1,
          'Points of Authority': 1,
          'Crawling (Official HD Video)': 1,
          'Runaway': 1,
          'By Myself': 1,
          'In the End': 3,
          'A Place for My Head': 1,
          'Forgotten': 1,
          'Cure for the Itch': 1,
          'Pushing Me Away': 1
        },
        completePlays: 0
      }
    };

    const cleaned = cleanAlbumsDict(importedAlbum);
    assert.equal(cleaned['hybrid theory:::linkin park'].completePlays, 1);
    assert.equal(cleaned['hybrid theory:::linkin park'].totalTracks, 12);
  });
});
