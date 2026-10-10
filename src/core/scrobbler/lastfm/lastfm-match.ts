/**
 * Helpers used to match track info reported by a connector against the
 * tracks stored in the Last.fm database.
 *
 * Track info taken from a website rarely matches Last.fm data exactly:
 * video titles contain decorations like "(Official Video)" or an unbracketed
 * "ft. …" credit, artist and track are sometimes merged into a single
 * string, and stylized spellings ("JAŸ-Z") are common. Because of that,
 * plain string equality cannot be used to tell whether Last.fm already
 * knows the track, and a search has to be used to find the matching entry.
 */
import { removeMetadataDecorations } from '@/util/util';

/**
 * Track that can be used to correct the info reported by a connector.
 */
export interface TrackMatchCandidate {
	/** Artist of the candidate track. */
	artist: string;
	/** Title of the candidate track. */
	name: string;
	/** Number of Last.fm listeners; used to compare popularity. */
	listeners?: number;
	/** URL of the track page on Last.fm. */
	url?: string;
}

/**
 * Track info as it was reported by a connector.
 */
export interface TrackMatchQuery {
	/** Artist reported by the connector. */
	artist?: string | null;
	/** Track title reported by the connector. */
	track?: string | null;
}

/**
 * Minimum similarity of track titles for a candidate to be considered.
 */
export const TITLE_SIMILARITY_FLOOR = 0.7;

/**
 * Minimum similarity of "artist track" pairs for a candidate with an
 * unrelated artist to be considered.
 */
export const COMBINED_SIMILARITY_FLOOR = 0.6;

/**
 * Minimum similarity of "artist track" pairs for a candidate to be
 * considered even if its title alone is not close enough, e.g. when the
 * reported info is a bit different from the one stored on Last.fm.
 */
export const STRONG_COMBINED_SIMILARITY_FLOOR = 0.8;

/**
 * Minimum similarity of artists for a candidate to be considered as
 * having the reported artist on its own. This only complements the
 * word-by-word prefix check; a lower bigram-based threshold is not used,
 * because short artist names share a lot of character bigrams by chance,
 * e.g. "Yakuza 6" and "Takaya Kuroda".
 */
export const STRONG_ARTIST_SIMILARITY_FLOOR = 0.55;

/**
 * Minimum similarity of track titles for a candidate to be considered by
 * the last-resort search, used when no candidate passes the strict checks
 * above. As long as the artist resembles the reported one, a candidate
 * with a close (but not perfect) title is still acceptable.
 */
export const RELAXED_TITLE_SIMILARITY_FLOOR = 0.5;

/**
 * Minimum similarity of "artist track" pairs for a candidate to be
 * considered by the last-resort search even without a matching artist.
 */
export const RELAXED_COMBINED_SIMILARITY_FLOOR = 0.7;

/**
 * Minimum similarity of the artist of an already found Last.fm entry; if
 * that entry does not resemble the reported artist, a better one is
 * searched for.
 */
export const RESOLVED_ARTIST_SIMILARITY_FLOOR = 0.5;

/**
 * Characters that are not decomposed by Unicode normalization, but that
 * are commonly used instead of their ASCII counterparts.
 */
const CHARACTER_REPLACEMENTS: Record<string, string> = {
	ß: 'ss',
	æ: 'ae',
	œ: 'oe',
	ø: 'o',
	đ: 'd',
	ð: 'd',
	þ: 'th',
	ł: 'l',
	ÿ: 'y',
	ı: 'i',
	ŧ: 't',
	ŋ: 'n',
	ħ: 'h',
	ſ: 's',
};

/**
 * Tokens describing a release rather than a distinct track; they are
 * removed before comparing titles, so that e.g. "Song (Radio Edit)" is
 * compared as "Song".
 */
const NOISE_TOKENS = new Set([
	'album',
	'bonus',
	'deluxe',
	'edit',
	'explicit',
	'mastered',
	'mono',
	'radio',
	'remaster',
	'remastered',
	'single',
	'stereo',
	'track',
	'version',
]);

/**
 * Tokens describing a specific version of a track. A candidate is only
 * used if both titles share the same set of these tokens, so that e.g. a
 * live recording is never replaced by the studio version and vice versa.
 */
const VERSION_TOKENS = new Set([
	'acoustic',
	'bootleg',
	'club',
	'cover',
	'demo',
	'extended',
	'instrumental',
	'karaoke',
	'live',
	'mashup',
	'mix',
	'nightcore',
	'original',
	'reprise',
	'remix',
	'rmx',
	'session',
	'slowed',
	'sped',
	'unplugged',
	'vip',
]);

/**
 * Strip site-specific junk from a reported track title to leave the
 * actual song title: a leading "Label:" segment and a trailing
 * single-word parenthetical credit, e.g. "Karaoke: Today is a Diamond
 * (Kiryu)" becomes "Today is a Diamond". Multi-word subtitles (like
 * "Tonight (Best I Ever Had)") and version qualifiers (like "Song
 * (Live at Wembley)") are kept as they are.
 *
 * @param text - Track title reported by the connector
 * @returns Title without the site-specific junk
 */
function stripSiteTitle(text: string): string {
	if (!text) {
		return text;
	}

	const versionOrNoiseTokens = new Set([...VERSION_TOKENS, ...NOISE_TOKENS]);

	// A leading segment ending with a colon, e.g. "Karaoke: …".
	let result = text.replace(/^[^\s:]{1,20}\s*:\s+/u, '');

	/*
	 * Trailing single-word parenthetical credits, e.g. "(Kiryu)". They
	 * are removed (repeatedly) unless they describe the version of the
	 * track, e.g. "(Live)".
	 */
	for (let i = 0; i < 5; ++i) {
		const group = /(?:\(([^()]*)\)|（([^（）]*)）)$/u.exec(result);
		if (!group) {
			break;
		}

		const content = (group[1] ?? group[2]).trim();
		const tokens = content.toLowerCase().split(/\s+/u).filter(Boolean);
		if (tokens.length !== 1 || versionOrNoiseTokens.has(tokens[0])) {
			break;
		}

		result = result.slice(0, group.index).replace(/\s+$/u, '');
	}

	return result.trim();
}

/**
 * Bracketed producer credit, e.g. "(prod. by Guy-Manuel de Homem-Christo)".
 * Credits like that are common in video titles, but are not a part of the
 * actual track title.
 */
const BRACKETED_PRODUCER_PATTERN =
	/[[(【（［]\s*(?:prod\.?|produced)\s+by\s+[^)\]】）］]+[)\]】）］]/gi;

/**
 * Remove a bracketed producer credit from a reported track title while
 * keeping its original casing, e.g. "RHYNO (prod. by Guy-Manuel de
 * Homem-Christo)" becomes "RHYNO".
 *
 * @param text - Track title reported by the connector
 * @returns Title without the producer credit
 */
export function removeProducerCredit(text: string): string {
	if (!text) {
		return text;
	}

	return (
		text
			.replace(BRACKETED_PRODUCER_PATTERN, ' ')
			.replace(/\s{2,}/g, ' ')
			.trim() || text
	);
}

/**
 * Bracketed feat. credit, e.g. "(feat. Otis Redding)".
 */
const BRACKETED_FEAT_PATTERN =
	/[[(【（［][^)\]】）］]*\b(?:feat|ft|featuring)\b[^)\]】）］]*[)\]】）］]/gi;

/**
 * Unbracketed feat. credit, e.g. "ft. Otis Redding".
 */
const UNBRACKETED_FEAT_PATTERN = /(?:^|\s)(?:feat|ft|featuring)\b\.?/i;

/**
 * Normalize text for comparison: remove diacritics and characters that
 * have no ASCII decomposition, drop punctuation and casing, and replace
 * ampersands with "and".
 *
 * @param text - Text to normalize
 * @returns Normalized text
 */
export function normalizeForMatch(text: string): string {
	if (!text) {
		return '';
	}

	return text
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(
			/[ßæœøđðþłÿıŧŋħſ]/g,
			(character) => CHARACTER_REPLACEMENTS[character] ?? character,
		)
		.replace(/&/g, ' and ')
		.replace(/['’ʼ´`]/g, '')
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim();
}

/**
 * Remove feat. credits from text while keeping its original casing,
 * e.g. "Otis ft. Otis Redding" becomes "Otis".
 *
 * Bracketed credits are removed as well, e.g. "Song (feat. Artist)"
 * becomes "Song".
 *
 * @param text - Text to process
 * @returns Text without feat. credits
 */
export function removeFeatSuffix(text: string): string {
	if (!text) {
		return text;
	}

	const result = text
		.replace(BRACKETED_FEAT_PATTERN, ' ')
		.replace(/(?:^|\s)(?:[-–—|]\s*)?(?:feat|ft|featuring)\b\.?\s+.+$/i, ' ')
		.replace(/\s{2,}/g, ' ')
		.trim();

	return result || text;
}

/**
 * Prepare a track title to be used as a Last.fm search query: site
 * decorations, producer credits and feat. credits are removed to search
 * for the actual song, e.g. "Otis ft. Otis Redding (Official Audio)"
 * becomes "Otis" and "Karaoke: Today is a Diamond (Kiryu)" becomes
 * "Today is a Diamond".
 *
 * @param track - Track title reported by the connector
 * @returns Text to search for
 */
export function prepareSearchQuery(track: string): string {
	if (!track) {
		return track;
	}

	const cleaned = stripSiteTitle(
		removeProducerCredit(
			removeFeatSuffix(removeMetadataDecorations(track)),
		),
	).trim();

	return cleaned || track;
}

/**
 * Clean up a track title reported by a connector so that it can be
 * compared with the titles stored on Last.fm. On top of {@link
 * cleanForMatch}, it also strips site-specific junk from the *reported*
 * (query) side only: a leading "Label:" segment, a trailing single-word
 * parenthetical credit, and producer credits. Candidates found on Last.fm
 * keep those parts, e.g. "Karaoke: Today is a Diamond (Kiryu)" is compared
 * as "today is a diamond".
 *
 * @param text - Track title reported by the connector
 * @returns Cleaned up text
 */
export function cleanQueryForMatch(text: string): string {
	return toCleanTokens(stripSiteTitle(removeProducerCredit(text))).join(' ');
}

/**
 * Split text into normalized tokens with all noise removed; the tokens
 * are used to compare track titles and artists.
 *
 * @param text - Text to split
 * @returns List of tokens
 */
function toCleanTokens(text: string): string[] {
	const normalized = normalizeForMatch(
		removeFeatSuffix(removeMetadataDecorations(text)),
	);

	if (!normalized) {
		return [];
	}

	const tokens = normalized.split(' ');
	const cleanedTokens = tokens.filter((token) => {
		return !NOISE_TOKENS.has(token) && !/^\p{N}+$/u.test(token);
	});

	/*
	 * A title made up of noise only, e.g. "1984", is compared as is
	 * instead of being compared as an empty string.
	 */
	return cleanedTokens.length > 0 ? cleanedTokens : tokens;
}

/**
 * Get text ready to be compared with another piece of track info:
 * decorations and feat. credits removed, noise tokens dropped, and
 * everything normalized.
 *
 * @param text - Text to clean up
 * @returns Cleaned up text
 */
export function cleanForMatch(text: string): string {
	return toCleanTokens(text).join(' ');
}

/**
 * Get an artist name ready to be compared with another artist name.
 *
 * Unlike {@link cleanForMatch}, pure-number tokens are kept, because
 * numbers are often a part of an artist name, e.g. "Yakuza 6", "21
 * Savage" or "3 Doors Down".
 *
 * @param text - Artist name to clean up
 * @returns Cleaned up text
 */
export function cleanArtistForMatch(text: string): string {
	if (!text) {
		return '';
	}

	const normalized = normalizeForMatch(
		removeFeatSuffix(removeMetadataDecorations(text)),
	);
	if (!normalized) {
		return '';
	}

	const tokens = normalized
		.split(' ')
		.filter((token) => !NOISE_TOKENS.has(token));

	return tokens.length > 0 ? tokens.join(' ') : normalized;
}

/**
 * Get the set of version tokens shared by the titles, e.g. "live" for
 * "Song (Live at Wembley)".
 *
 * @param text - Title to examine
 * @returns Set of version tokens
 */
function getVersionTokens(text: string): Set<string> {
	return new Set(
		toCleanTokens(text).filter((token) => VERSION_TOKENS.has(token)),
	);
}

/**
 * Check whether two titles describe the same version of a track, i.e.
 * whether they share the same set of version tokens.
 *
 * @param first - First title
 * @param second - Second title
 * @returns True if the titles describe the same version
 */
function areVersionsEqual(first: string, second: string): boolean {
	const firstTokens = getVersionTokens(first);
	const secondTokens = getVersionTokens(second);

	if (firstTokens.size !== secondTokens.size) {
		return false;
	}

	for (const token of firstTokens) {
		if (!secondTokens.has(token)) {
			return false;
		}
	}

	return true;
}

/**
 * Compute similarity of two normalized strings using the Dice coefficient
 * of their character bigrams, giving extra credit to one string being a
 * part of the other.
 *
 * @param first - First string
 * @param second - Second string
 * @return Similarity in the range from 0 to 1
 */
export function similarity(first: string, second: string): number {
	if (!first || !second) {
		return first === second ? 1 : 0;
	}

	if (first === second) {
		return 1;
	}

	const diceCoefficient = getDiceCoefficient(first, second);

	if (!first.includes(second) && !second.includes(first)) {
		return diceCoefficient;
	}

	const containment =
		Math.min(first.length, second.length) /
		Math.max(first.length, second.length);

	return Math.max(diceCoefficient, containment);
}

/**
 * Compute the Dice coefficient of character bigrams of two strings.
 *
 * @param first - First string
 * @param second - Second string
 * @return Coefficient in the range from 0 to 1
 */
function getDiceCoefficient(first: string, second: string): number {
	const firstBigrams = getBigrams(first);
	const secondBigrams = getBigrams(second);

	if (firstBigrams.length === 0 || secondBigrams.length === 0) {
		return 0;
	}

	const counts = new Map<string, number>();
	for (const bigram of firstBigrams) {
		counts.set(bigram, (counts.get(bigram) ?? 0) + 1);
	}

	let hits = 0;
	for (const bigram of secondBigrams) {
		const count = counts.get(bigram) ?? 0;
		if (count > 0) {
			++hits;
			counts.set(bigram, count - 1);
		}
	}

	return (2 * hits) / (firstBigrams.length + secondBigrams.length);
}

/**
 * Get all character bigrams of a string.
 *
 * @param text - String to process
 * @return List of bigrams
 */
function getBigrams(text: string): string[] {
	const bigrams: string[] = [];

	for (let index = 0; index < text.length - 1; ++index) {
		bigrams.push(text.slice(index, index + 2));
	}

	return bigrams;
}

/**
 * Check whether a track title looks like a title taken from a media site
 * rather than from Last.fm.
 *
 * Bracketed decorations ("(Official Video)") and an unbracketed "ft."
 * credit ("Otis ft. Otis Redding") are typical for site titles, while
 * Last.fm stores credits as "(feat. …)".
 *
 * @param text - Track title to check
 * @returns True if the title contains site-specific junk
 */
export function looksLikeSiteTitle(text: string): boolean {
	if (!text) {
		return false;
	}

	if (removeMetadataDecorations(text) !== text) {
		return true;
	}

	return UNBRACKETED_FEAT_PATTERN.test(
		text.replace(BRACKETED_FEAT_PATTERN, ' '),
	);
}

/**
 * Check whether the track info found on Last.fm is close enough to the
 * info reported by a connector, or whether a better matching track should
 * be searched for.
 *
 * @param query - Track info reported by the connector
 * @param resolvedArtist - Artist of the track found on Last.fm
 * @param resolvedTrack - Title of the track found on Last.fm
 * @returns True if a better matching track should be searched for
 */
export function shouldImproveMatch(
	query: TrackMatchQuery,
	resolvedArtist: string,
	resolvedTrack: string,
): boolean {
	const queryTrack = cleanQueryForMatch(query.track ?? '');
	if (!queryTrack) {
		return false;
	}

	const resolvedTrackClean = cleanForMatch(resolvedTrack);

	/*
	 * Entries describing another version of the track, e.g. a karaoke
	 * version of a studio track, should be replaced with a better match.
	 */
	if (!areVersionsEqual(queryTrack, resolvedTrackClean)) {
		return true;
	}

	if (similarity(queryTrack, resolvedTrackClean) < TITLE_SIMILARITY_FLOOR) {
		return true;
	}

	if (looksLikeSiteTitle(resolvedTrack)) {
		return true;
	}

	const queryArtist = cleanArtistForMatch(query.artist ?? '');
	const resolvedArtistClean = cleanArtistForMatch(resolvedArtist);
	if (queryArtist && resolvedArtistClean) {
		return (
			similarity(queryArtist, resolvedArtistClean) <
			RESOLVED_ARTIST_SIMILARITY_FLOOR
		);
	}

	return false;
}

/**
 * Check whether a candidate is fully described by the reported track
 * title; this is the case when the connector failed to split artist and
 * track out of a single string, e.g. when the reported title is
 * "JAY-Z, Kanye West - Otis".
 *
 * @param queryTrack - Track title reported by the connector
 * @param candidateArtist - Artist of the candidate track
 * @param candidateTrack - Title of the candidate track
 * @returns True if both artist and title are a part of the reported title
 */
function isCoveredByQueryTrack(
	queryTrack: string,
	candidateArtist: string,
	candidateTrack: string,
): boolean {
	if (!queryTrack || !candidateArtist || !candidateTrack) {
		return false;
	}

	const queryTokens = new Set(queryTrack.split(' '));

	return (
		candidateArtist.split(' ').every((token) => queryTokens.has(token)) &&
		candidateTrack.split(' ').every((token) => queryTokens.has(token))
	);
}

/**
 * Check whether one of the artists is the prefix of the other one, word
 * by word. This is the case for "Yakuza 6" and "Yakuza 6: The Song of
 * Life", or "JAY-Z" and "JAY-Z, Kanye West"; unlike raw bigram
 * similarity it does not match near-anagrams such as "Takaya Kuroda".
 *
 * @param first - First artist, already cleaned
 * @param second - Second artist, already cleaned
 * @returns True if one artist name prefixes the other one
 */
function hasPrefixArtistMatch(first: string, second: string): boolean {
	const firstTokens = first.split(' ').filter(Boolean);
	const secondTokens = second.split(' ').filter(Boolean);

	if (firstTokens.length === 0 || secondTokens.length === 0) {
		return false;
	}

	const isPrefix = (prefix: string[], whole: string[]): boolean => {
		return (
			prefix.length <= whole.length &&
			whole.slice(0, prefix.length).join(' ') === prefix.join(' ')
		);
	};

	return (
		isPrefix(firstTokens, secondTokens) ||
		isPrefix(secondTokens, firstTokens)
	);
}

/**
 * Find the track that best matches the info reported by a connector.
 *
 * Candidates with a close title are considered, candidates whose artist
 * resembles the reported artist are preferred, and the most popular of
 * them wins. Candidates describing another version of the track, e.g. a
 * live recording of a studio track, are ignored.
 *
 * If no candidate passes the checks above, use the most popular candidate
 * that still resembles the reported track well enough, so that a scrobble
 * is not lost when a site title is too decorated to match the Last.fm
 * entry exactly, e.g. "RHYNO (From Grand Theft Auto VI: The Album)".
 *
 * @param candidates - List of tracks found on Last.fm
 * @param query - Track info reported by the connector
 * @returns The best matching track, or null if there is no good match
 */
export function pickBestTrackMatch(
	candidates: TrackMatchCandidate[],
	query: TrackMatchQuery,
): TrackMatchCandidate | null {
	const queryTrack = cleanQueryForMatch(query.track ?? '');
	const queryArtist = cleanArtistForMatch(query.artist ?? '');
	const queryCombined = [queryArtist, queryTrack].filter(Boolean).join(' ');

	if (!queryTrack) {
		return null;
	}

	interface ScoredCandidate {
		candidate: TrackMatchCandidate;
		titleSimilarity: number;
		artistSimilarity: number;
		combinedSimilarity: number;
		hasArtistSupport: boolean;
		listeners: number;
	}

	const scoredCandidates: ScoredCandidate[] = [];

	for (const candidate of candidates) {
		if (!candidate?.artist || !candidate?.name) {
			continue;
		}

		const candidateTrack = cleanForMatch(candidate.name);
		const candidateArtist = cleanArtistForMatch(candidate.artist);
		const candidateCombined = [candidateArtist, candidateTrack]
			.filter(Boolean)
			.join(' ');

		if (!candidateTrack || !areVersionsEqual(queryTrack, candidateTrack)) {
			continue;
		}

		scoredCandidates.push({
			candidate,
			titleSimilarity: similarity(queryTrack, candidateTrack),
			artistSimilarity: similarity(queryArtist, candidateArtist),
			combinedSimilarity: similarity(queryCombined, candidateCombined),
			hasArtistSupport:
				similarity(queryArtist, candidateArtist) >=
					STRONG_ARTIST_SIMILARITY_FLOOR ||
				hasPrefixArtistMatch(queryArtist, candidateArtist),
			listeners: candidate.listeners ?? 0,
		});
	}

	/*
	 * Use the closest title first and the most popular version of it to
	 * break ties. Prefer candidates whose artist resembles the reported
	 * artist; if there are none, e.g. because the reported artist is a
	 * channel name, fall back to all of the given candidates.
	 */
	const pickBest = (eligible: ScoredCandidate[]): ScoredCandidate | null => {
		if (eligible.length === 0) {
			return null;
		}

		const candidatesWithArtist = eligible.filter(
			(scored) => scored.hasArtistSupport,
		);
		const pool =
			candidatesWithArtist.length > 0 ? candidatesWithArtist : eligible;

		return pool.reduce((prev, current) => {
			if (current.titleSimilarity !== prev.titleSimilarity) {
				return current.titleSimilarity > prev.titleSimilarity
					? current
					: prev;
			}

			if (current.listeners !== prev.listeners) {
				return current.listeners > prev.listeners ? current : prev;
			}

			return current.artistSimilarity > prev.artistSimilarity
				? current
				: prev;
		});
	};

	/*
	 * Candidates are accepted if the title is close and either the artist
	 * resembles the reported one or the combined "artist track" strings
	 * are close, if the combined strings are very close, or if the
	 * candidate is fully described by the reported title (which is the
	 * case when a connector failed to split artist and track).
	 */
	const strictMatch = pickBest(
		scoredCandidates.filter((scored) => {
			const candidateTrack = cleanForMatch(scored.candidate.name);
			const candidateArtist = cleanArtistForMatch(
				scored.candidate.artist,
			);
			return (
				(scored.titleSimilarity >= TITLE_SIMILARITY_FLOOR &&
					(scored.hasArtistSupport ||
						scored.combinedSimilarity >=
							COMBINED_SIMILARITY_FLOOR)) ||
				scored.combinedSimilarity >= STRONG_COMBINED_SIMILARITY_FLOOR ||
				isCoveredByQueryTrack(
					queryTrack,
					candidateArtist,
					candidateTrack,
				)
			);
		}),
	);
	if (strictMatch) {
		return strictMatch.candidate;
	}

	/*
	 * If nothing passed the strict checks, fall back to the most popular
	 * candidate whose artist resembles the reported one and whose title is
	 * still reasonably close, so that decorated site titles keep working.
	 */
	const relaxedMatch = pickBest(
		scoredCandidates.filter((scored) => {
			return (
				(scored.titleSimilarity >= RELAXED_TITLE_SIMILARITY_FLOOR &&
					scored.hasArtistSupport) ||
				scored.combinedSimilarity >= RELAXED_COMBINED_SIMILARITY_FLOOR
			);
		}),
	);

	return relaxedMatch ? relaxedMatch.candidate : null;
}
