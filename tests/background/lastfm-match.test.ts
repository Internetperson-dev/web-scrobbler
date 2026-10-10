/**
 * Tests for Last.fm track matching helpers.
 */

import { expect, describe, it } from 'vitest';
import {
	cleanForMatch,
	looksLikeSiteTitle,
	normalizeForMatch,
	pickBestTrackMatch,
	prepareSearchQuery,
	shouldImproveMatch,
	similarity,
} from '@/core/scrobbler/lastfm/lastfm-match';
import type { TrackMatchCandidate } from '@/core/scrobbler/lastfm/lastfm-match';

/**
 * Real Last.fm search results for the track reported as
 * "JAŸ-Z, Kanye West - Otis ft. Otis Redding" by the YouTube connector.
 */
const OTIS_SEARCH_RESULTS: TrackMatchCandidate[] = [
	{ artist: 'JAŸ-Z', name: 'Otis', listeners: 169190 },
	{ artist: 'JAY-Z', name: 'Otis', listeners: 662263 },
	{ artist: 'JAY Z', name: 'Otis', listeners: 153388 },
	{ artist: 'The Durutti Column', name: 'Otis', listeners: 89222 },
	{ artist: 'Lambert', name: 'Otis', listeners: 42905 },
	{
		artist: 'JAŸ-Z, Kanye West, Otis Redding',
		name: 'Otis',
		listeners: 2672,
	},
	{
		artist: 'Jay-Z, Kanye West',
		name: 'Otis ft. Otis Redding',
		listeners: 86,
	},
	{
		artist: 'The Throne',
		name: 'Otis ft. Otis Redding (AUDIO)',
		listeners: 26,
	},
];

function testNormalizeForMatch() {
	it('should remove diacritics', () => {
		expect(normalizeForMatch('Beyoncé')).to.be.equal('beyonce');
	});

	it('should replace stylized characters', () => {
		expect(normalizeForMatch('JAŸ-Z, Kanye West')).to.be.equal(
			'jay z kanye west',
		);
	});

	it('should drop punctuation and casing', () => {
		expect(normalizeForMatch("Don't: Stop/Me")).to.be.equal('dont stop me');
	});

	it('should replace ampersand with "and"', () => {
		expect(normalizeForMatch('Simon & Garfunkel')).to.be.equal(
			'simon and garfunkel',
		);
	});

	it('should return an empty string for empty input', () => {
		expect(normalizeForMatch('')).to.be.equal('');
	});
}

function testSimilarity() {
	it('should return 1 for equal strings', () => {
		expect(similarity('otis', 'otis')).to.be.equal(1);
	});

	it('should return 0 for empty strings', () => {
		expect(similarity('otis', '')).to.be.equal(0);
		expect(similarity('', '')).to.be.equal(1);
	});

	it('should be low for unrelated strings of similar length', () => {
		expect(
			similarity('jay z kanye west', 'the durutti column'),
		).to.be.lessThan(0.2);
	});

	it('should take containment into account', () => {
		expect(similarity('jay z', 'jay z kanye west')).to.be.greaterThan(0.4);
	});

	it('should be high for strings with a common part', () => {
		expect(similarity('some song', 'other some song')).to.be.greaterThan(
			0.5,
		);
	});
}

function testCleanForMatch() {
	it('should remove decorations and feat. credits', () => {
		expect(
			cleanForMatch('Otis ft. Otis Redding (Official Video)'),
		).to.be.equal('otis');
	});

	it('should remove noise tokens', () => {
		expect(
			cleanForMatch('Song (Radio Edit) [Remastered 2011]'),
		).to.be.equal('song');
	});

	it('should keep version tokens', () => {
		expect(cleanForMatch('Song (Live at Wembley)')).to.be.equal(
			'song live at wembley',
		);
	});

	it('should keep a title made up of numbers', () => {
		expect(cleanForMatch('1984')).to.be.equal('1984');
	});
}

function testPrepareSearchQuery() {
	it('should remove decorations and feat. credits', () => {
		expect(
			prepareSearchQuery('Otis ft. Otis Redding (Official Audio)'),
		).to.be.equal('Otis');
	});

	it('should keep the title as is if there is nothing to remove', () => {
		expect(prepareSearchQuery('Midnight Drive')).to.be.equal(
			'Midnight Drive',
		);
	});
}

function testLooksLikeSiteTitle() {
	it('should detect an unbracketed feat. credit', () => {
		expect(looksLikeSiteTitle('Otis ft. Otis Redding')).to.equal(true);
	});

	it('should detect site decorations', () => {
		expect(looksLikeSiteTitle('Song (Official Video)')).to.equal(true);
		expect(looksLikeSiteTitle('Song [Lyrics]')).to.equal(true);
	});

	it('should not detect a Last.fm-style title', () => {
		expect(looksLikeSiteTitle('Otis (feat. Otis Redding)')).to.equal(false);
		expect(looksLikeSiteTitle('Otis')).to.equal(false);
	});
}

function testShouldImproveMatch() {
	const query = {
		artist: 'JAY-Z, Kanye West',
		track: 'Otis ft. Otis Redding',
	};

	it('should improve a title taken from a video site', () => {
		expect(
			shouldImproveMatch(query, 'The Throne', 'Otis ft. Otis Redding'),
		).to.equal(true);
	});

	it('should improve a mismatching artist', () => {
		expect(
			shouldImproveMatch(
				{ artist: 'Some Channel', track: 'Midnight Drive' },
				'Totally Unrelated Band',
				'Midnight Drive',
			),
		).to.equal(true);
	});

	it('should not improve matching info', () => {
		expect(
			shouldImproveMatch(query, 'JAY-Z & Kanye West', 'Otis'),
		).to.equal(false);
	});

	it('should not search if the track title is empty', () => {
		expect(
			shouldImproveMatch({ artist: 'Artist', track: '' }, 'A', 'B'),
		).to.equal(false);
	});
}

function testPickBestTrackMatch() {
	it('should pick the most popular version of the closest title', () => {
		const match = pickBestTrackMatch(OTIS_SEARCH_RESULTS, {
			artist: 'JAŸ-Z, Kanye West',
			track: 'Otis ft. Otis Redding',
		});

		expect(match).to.not.equal(null);
		expect(match?.name).to.be.equal('Otis');
		expect(match?.artist).to.be.equal('JAY-Z');
	});

	it('should ignore tracks by unrelated artists', () => {
		const match = pickBestTrackMatch(
			[
				{
					artist: 'Totally Unrelated Band',
					name: 'Midnight Drive',
					listeners: 1000000,
				},
			],
			{ artist: 'Some Channel', track: 'Midnight Drive' },
		);

		expect(match).to.equal(null);
	});

	it('should find a track for an unsplit title', () => {
		const match = pickBestTrackMatch(
			[
				{ artist: 'JAY-Z', name: 'Otis', listeners: 662263 },
				{
					artist: 'Some Other Artist',
					name: 'Something Completely Different',
					listeners: 900000,
				},
			],
			{
				artist: 'Music Channel',
				track: 'JAY-Z, Kanye West - Otis ft. Otis Redding',
			},
		);

		expect(match).to.not.equal(null);
		expect(match?.name).to.be.equal('Otis');
		expect(match?.artist).to.be.equal('JAY-Z');
	});

	it('should not replace a track with another version of it', () => {
		const match = pickBestTrackMatch(
			[
				{
					artist: 'Radiohead',
					name: 'Paranoid Android (Live)',
					listeners: 5000000,
				},
			],
			{ artist: 'Radiohead', track: 'Paranoid Android' },
		);

		expect(match).to.equal(null);
	});

	it('should return null if there are no candidates', () => {
		expect(
			pickBestTrackMatch([], { artist: 'Artist', track: 'Song' }),
		).to.equal(null);
	});
}

/**
 * Run all tests.
 */
function runTests() {
	describe('normalizeForMatch', testNormalizeForMatch);
	describe('similarity', testSimilarity);
	describe('cleanForMatch', testCleanForMatch);
	describe('prepareSearchQuery', testPrepareSearchQuery);
	describe('looksLikeSiteTitle', testLooksLikeSiteTitle);
	describe('shouldImproveMatch', testShouldImproveMatch);
	describe('pickBestTrackMatch', testPickBestTrackMatch);
}

runTests();
