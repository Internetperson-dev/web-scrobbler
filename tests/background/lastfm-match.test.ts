/**
 * Tests for Last.fm track matching helpers.
 */

import { expect, describe, it } from 'vitest';
import {
	cleanForMatch,
	cleanQueryForMatch,
	looksLikeSiteTitle,
	normalizeForMatch,
	pickBestTrackMatch,
	prepareSearchQuery,
	removeProducerCredit,
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

/**
 * Real Last.fm search results for the track reported as
 * "Yakuza 6 - Karaoke: Today is a Diamond (Kiryu)" by the YouTube
 * connector.
 */
const YAKUZA_SEARCH_RESULTS: TrackMatchCandidate[] = [
	{
		artist: 'Yakuza 6: The Song of Life',
		name: 'Today is a Diamond',
		listeners: 10,
	},
	{ artist: 'Takaya Kuroda', name: 'Today Is A Diamond', listeners: 62 },
	{
		artist: '桐生一馬(黒田崇矢)',
		name: 'Today is a diamond - Full Spec Edition',
		listeners: 19562,
	},
	{
		artist: 'Kazuma Kiryu(Takaya Kuroda)',
		name: 'Today is a diamond - Full Spec Edition',
		listeners: 5392,
	},
	{ artist: 'Today is a Diamond', name: 'Full Spec Edition', listeners: 37 },
	{ artist: 'smooth_bass', name: 'Today is a Diamond', listeners: 21 },
	{
		artist: 'Kazuma Kiryu(Takaya Kuroda)',
		name: 'Today Is a Diamond (Full Spec Edition)',
		listeners: 265,
	},
	{
		artist: 'Yakuza 6',
		name: 'Karaoke: Today is a Diamond (Kiryu)',
		listeners: 234,
	},
	{ artist: 'Kiryu Kazuma', name: 'Today Is A Diamond', listeners: 17 },
	{
		artist: 'Takaya Kuroda',
		name: 'Today Is A Diamond (Full Spec Edition)',
		listeners: 15,
	},
	{ artist: 'M.Reizuku', name: 'Today is a Diamond', listeners: 11 },
	{
		artist: 'Kazuma Kiryu(Takaya Kuroda)',
		name: 'Today is a diamond【Full Spec Edition】',
		listeners: 279,
	},
];

/**
 * Real Last.fm search results for the track reported as
 * "Travis Scott - RHYNO (from GTA VI: The Album)" by the YouTube
 * connector; the entry to scrobble to is
 * "Travis Scott - RHYNO (from GTAVI: The Album)".
 */
const RHYNO_SEARCH_RESULTS: TrackMatchCandidate[] = [
	{
		artist: 'Travis Scott',
		name: 'RHYNO (from GTAVI: The Album)',
		listeners: 33407,
	},
	{
		artist: 'Travis Scott, Grand Theft Auto VI',
		name: 'RHYNO (from GTAVI: The Album)',
		listeners: 1534,
	},
	{
		artist: 'Travis Scott & Grand Theft Auto VI',
		name: 'RHYNO (from GTAVI: The Album)',
		listeners: 415,
	},
	{
		artist: 'RHYNO (from GTAVI',
		name: 'The Album)',
		listeners: 143,
	},
	{
		artist: 'トラヴィス・スコット',
		name: 'RHYNO (from GTAVI: The Album)',
		listeners: 49,
	},
	{
		artist: 'Travis Scott e Grand Theft Auto VI',
		name: 'RHYNO (from GTAVI: The Album)',
		listeners: 78,
	},
	{
		artist: 'Grand Theft Auto VI',
		name: 'RHYNO',
		listeners: 16,
	},
	{
		artist: 'Grand Theft Auto VI',
		name: 'Suzuki (from GTAVI: The Album)',
		listeners: 191,
	},
	{
		artist: 'Grand Theft Auto VI',
		name: 'Don’t Chart (from GTAVI: The Album)',
		listeners: 266,
	},
	{
		artist: 'Atlantic Records',
		name:
			'Travis Scott – RHYNO (prod. by Guy-Manuel de Homem-Christo) ' +
			'(From Grand Theft Auto VI: The Album)',
		listeners: 75,
	},
	{
		artist: 'Rauw Alejandro, Grand Theft Auto VI',
		name: 'Macacoa 2000 (from GTAVI: The Album)',
		listeners: 694,
	},
];

/**
 * Real Last.fm search results for the track reported as "Travis Scott -
 * RHYNO (prod. by Guy-Manuel de Homem-Christo) (From Grand Theft Auto VI:
 * The Album)" (the official upload title). No candidate has a close enough
 * title and a matching artist for the strict checks; the most popular
 * candidate that is still recognizable is used.
 */
const RHYNO_FULL_SPELLED_SEARCH_RESULTS: TrackMatchCandidate[] = [
	{
		artist: 'Travis Scott, Grand Theft Auto VI',
		name: 'RHYNO (from GTAVI: The Album)',
		listeners: 1534,
	},
	{
		artist: 'Travis Scott & Grand Theft Auto VI',
		name: 'RHYNO (from GTAVI: The Album)',
		listeners: 415,
	},
	{
		artist: 'Grand Theft Auto VI',
		name: 'RHYNO',
		listeners: 16,
	},
	{
		artist: 'Travis Scott e Grand Theft Auto VI',
		name: 'RHYNO (from GTAVI: The Album)',
		listeners: 78,
	},
	{
		artist: 'Travis Scott, Grand Theft Auto VI • Lossless',
		name: 'RHYNO (from GTAVI: The Album)',
		listeners: 17,
	},
	{
		artist: 'Grand Theft Auto VI, Travis Scott',
		name: 'RHYNO (from GTAVI: The Album)',
		listeners: 35,
	},
	{
		artist: 'Atlantic Records',
		name:
			'Travis Scott – RHYNO (prod. by Guy-Manuel de Homem-Christo) ' +
			'(From Grand Theft Auto VI: The Album)',
		listeners: 75,
	},
	{
		artist: 'Michael Hunter',
		name: 'Soviet Connection — The Theme From Grand Theft Auto IV',
		listeners: 66865,
	},
	{
		artist: 'Rockstar Games',
		name: 'Grand Theft Auto VI Trailer 1',
		listeners: 6226,
	},
	{
		artist: 'Grand Theft Auto VI',
		name: 'An Extended Look',
		listeners: 535,
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

function testRemoveProducerCredit() {
	it('should remove a bracketed producer credit', () => {
		expect(
			removeProducerCredit(
				'RHYNO (prod. by Guy-Manuel de Homem-Christo)',
			),
		).to.be.equal('RHYNO');
	});

	it('should remove a bracketed "produced by" credit', () => {
		expect(removeProducerCredit('Song (produced by Some Guy)')).to.be.equal(
			'Song',
		);
	});

	it('should keep a title without a producer credit', () => {
		expect(removeProducerCredit('Midnight Drive')).to.be.equal(
			'Midnight Drive',
		);
	});
}

function testCleanQueryForMatch() {
	it('should strip a leading label and a single-word credit', () => {
		expect(
			cleanQueryForMatch('Karaoke: Today is a Diamond (Kiryu)'),
		).to.be.equal('today is a diamond');
	});

	it('should keep a multi-word subtitle', () => {
		expect(cleanQueryForMatch('Tonight (Best I Ever Had)')).to.be.equal(
			'tonight best i ever had',
		);
	});

	it('should keep a version qualifier', () => {
		expect(cleanQueryForMatch('Song (Live at Wembley)')).to.be.equal(
			'song live at wembley',
		);
	});

	it('should remove a producer credit', () => {
		expect(
			cleanQueryForMatch(
				'RHYNO (prod. by Guy-Manuel de Homem-Christo) ' +
					'(from GTAVI: The Album)',
			),
		).to.be.equal('rhyno from gtavi the');
	});

	it('should keep a fully spelled subtitle', () => {
		expect(
			cleanQueryForMatch('RHYNO (From Grand Theft Auto VI: The Album)'),
		).to.be.equal('rhyno from grand theft auto vi the');
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

	it('should strip a karaoke label and a single-word credit', () => {
		expect(
			prepareSearchQuery('Karaoke: Today is a Diamond (Kiryu)'),
		).to.be.equal('Today is a Diamond');
	});

	it('should remove a producer credit', () => {
		expect(
			prepareSearchQuery(
				'RHYNO (prod. by Guy-Manuel de Homem-Christo) ' +
					'(from GTAVI: The Album)',
			),
		).to.be.equal('RHYNO (from GTAVI: The Album)');
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

	it('should improve a karaoke entry found for a site-style title', () => {
		expect(
			shouldImproveMatch(
				{
					artist: 'Yakuza 6',
					track: 'Karaoke: Today is a Diamond (Kiryu)',
				},
				'Yakuza 6',
				'Karaoke: Today is a Diamond (Kiryu)',
			),
		).to.equal(true);
	});

	it('should not search for a track that matches the Last.fm entry', () => {
		expect(
			shouldImproveMatch(
				{
					artist: 'Travis Scott',
					track: 'RHYNO (from GTAVI: The Album)',
				},
				'Travis Scott',
				'RHYNO (from GTAVI: The Album)',
			),
		).to.equal(false);
	});

	it('should not search if only the Last.fm spelling differs', () => {
		expect(
			shouldImproveMatch(
				{
					artist: 'Travis Scott',
					track: 'RHYNO (from GTA VI: The Album)',
				},
				'Travis Scott',
				'RHYNO (from GTAVI: The Album)',
			),
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

	it('should pick a canonical entry for a karaoke site title', () => {
		const match = pickBestTrackMatch(YAKUZA_SEARCH_RESULTS, {
			artist: 'Yakuza 6',
			track: 'Karaoke: Today is a Diamond (Kiryu)',
		});

		expect(match).to.not.equal(null);
		expect(match?.name).to.be.equal('Today is a Diamond');
		expect(match?.artist).to.be.equal('Yakuza 6: The Song of Life');
	});

	it('should pick the canonical RHYNO entry for the abbreviated title', () => {
		const match = pickBestTrackMatch(RHYNO_SEARCH_RESULTS, {
			artist: 'Travis Scott',
			track: 'RHYNO (from GTA VI: The Album)',
		});

		expect(match).to.not.equal(null);
		expect(match?.name).to.be.equal('RHYNO (from GTAVI: The Album)');
		expect(match?.artist).to.be.equal('Travis Scott');
	});

	it(
		'should pick the most popular recognizable RHYNO entry for the ' +
			'decorated official title',
		() => {
			const match = pickBestTrackMatch(
				RHYNO_FULL_SPELLED_SEARCH_RESULTS,
				{
					artist: 'Travis Scott',
					track:
						'RHYNO (prod. by Guy-Manuel de Homem-Christo) ' +
						'(From Grand Theft Auto VI: The Album)',
				},
			);

			expect(match).to.not.equal(null);
			expect(match?.name).to.be.equal('RHYNO (from GTAVI: The Album)');
			expect(match?.artist).to.be.equal(
				'Travis Scott, Grand Theft Auto VI',
			);
		},
	);

	it('should not replace a RHYNO entry with an unrelated popular track', () => {
		const match = pickBestTrackMatch(
			[
				...RHYNO_FULL_SPELLED_SEARCH_RESULTS,
				{
					artist: 'Michael Hunter',
					name: 'Soviet Connection — The Theme From Grand Theft Auto IV',
					listeners: 400000,
				},
				{ artist: 'Rhyno', name: 'RHYNO', listeners: 5000 },
			],
			{
				artist: 'Travis Scott',
				track:
					'RHYNO (prod. by Guy-Manuel de Homem-Christo) ' +
					'(From Grand Theft Auto VI: The Album)',
			},
		);

		expect(match).to.not.equal(null);
		expect(match?.name).to.be.equal('RHYNO (from GTAVI: The Album)');
		expect(match?.artist).to.be.equal('Travis Scott, Grand Theft Auto VI');
	});
}

/**
 * Run all tests.
 */
function runTests() {
	describe('normalizeForMatch', testNormalizeForMatch);
	describe('similarity', testSimilarity);
	describe('cleanForMatch', testCleanForMatch);
	describe('removeProducerCredit', testRemoveProducerCredit);
	describe('cleanQueryForMatch', testCleanQueryForMatch);
	describe('prepareSearchQuery', testPrepareSearchQuery);
	describe('looksLikeSiteTitle', testLooksLikeSiteTitle);
	describe('shouldImproveMatch', testShouldImproveMatch);
	describe('pickBestTrackMatch', testPickBestTrackMatch);
}

runTests();
