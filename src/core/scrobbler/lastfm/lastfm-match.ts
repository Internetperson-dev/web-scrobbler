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
 * Minimum similarity of artists for a candidate to be preferred over
 * candidates with a similar title but an unrelated artist.
 */
export const ARTIST_SIMILARITY_FLOOR = 0.35;

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
		.replace(/\s*(?:[-–—|]\s*)?(?:feat|ft|featuring)\b\.?\s+.+$/i, ' ')
		.replace(/\s{2,}/g, ' ')
		.trim();

	return result || text;
}

/**
 * Prepare a track title to be used as a Last.fm search query: site
 * decorations and feat. credits are removed to search for the actual
 * song, e.g. "Otis ft. Otis Redding (Official Audio)" becomes "Otis".
 *
 * @param track - Track title reported by the connector
 * @returns Text to search for
 */
export function prepareSearchQuery(track: string): string {
	if (!track) {
		return track;
	}

	return removeFeatSuffix(removeMetadataDecorations(track)).trim() || track;
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
	const queryTrack = cleanForMatch(query.track ?? '');
	if (!queryTrack) {
		return false;
	}

	if (
		similarity(queryTrack, cleanForMatch(resolvedTrack)) <
		TITLE_SIMILARITY_FLOOR
	) {
		return true;
	}

	if (looksLikeSiteTitle(resolvedTrack)) {
		return true;
	}

	const queryArtist = cleanForMatch(query.artist ?? '');
	if (queryArtist && cleanForMatch(resolvedArtist)) {
		return (
			similarity(queryArtist, cleanForMatch(resolvedArtist)) <
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
 * Find the track that best matches the info reported by a connector.
 *
 * Candidates with a close title are considered, candidates whose artist
 * resembles the reported artist are preferred, and the most popular of
 * them wins. Candidates describing another version of the track, e.g. a
 * live recording of a studio track, are ignored.
 *
 * @param candidates - List of tracks found on Last.fm
 * @param query - Track info reported by the connector
 * @returns The best matching track, or null if there is no good match
 */
export function pickBestTrackMatch(
	candidates: TrackMatchCandidate[],
	query: TrackMatchQuery,
): TrackMatchCandidate | null {
	const queryTrack = cleanForMatch(query.track ?? '');
	const queryArtist = cleanForMatch(query.artist ?? '');
	const queryCombined = [queryArtist, queryTrack].filter(Boolean).join(' ');

	if (!queryTrack) {
		return null;
	}

	const scoredCandidates = [];

	for (const candidate of candidates) {
		if (!candidate?.artist || !candidate?.name) {
			continue;
		}

		const candidateTrack = cleanForMatch(candidate.name);
		const candidateArtist = cleanForMatch(candidate.artist);
		const candidateCombined = [candidateArtist, candidateTrack]
			.filter(Boolean)
			.join(' ');

		if (!candidateTrack || !areVersionsEqual(queryTrack, candidateTrack)) {
			continue;
		}

		const titleSimilarity = similarity(queryTrack, candidateTrack);
		const artistSimilarity = similarity(queryArtist, candidateArtist);
		const combinedSimilarity = similarity(queryCombined, candidateCombined);

		const hasArtistSupport = artistSimilarity >= ARTIST_SIMILARITY_FLOOR;
		const isEligible =
			(titleSimilarity >= TITLE_SIMILARITY_FLOOR &&
				(hasArtistSupport ||
					combinedSimilarity >= COMBINED_SIMILARITY_FLOOR)) ||
			combinedSimilarity >= STRONG_COMBINED_SIMILARITY_FLOOR ||
			isCoveredByQueryTrack(queryTrack, candidateArtist, candidateTrack);

		if (!isEligible) {
			continue;
		}

		scoredCandidates.push({
			candidate,
			titleSimilarity,
			artistSimilarity,
			hasArtistSupport,
			listeners: candidate.listeners ?? 0,
		});
	}

	if (scoredCandidates.length === 0) {
		return null;
	}

	/*
	 * Prefer candidates whose artist resembles the reported artist; if
	 * there are none, e.g. because the reported artist is a channel name,
	 * fall back to all of the eligible candidates.
	 */
	const candidatesWithArtist = scoredCandidates.filter(
		(scored) => scored.hasArtistSupport,
	);
	const pool =
		candidatesWithArtist.length > 0
			? candidatesWithArtist
			: scoredCandidates;

	/*
	 * Of the remaining ones, use the closest title first and the most
	 * popular version of it to break ties.
	 */
	const best = pool.reduce((prev, current) => {
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

	return best.candidate;
}
