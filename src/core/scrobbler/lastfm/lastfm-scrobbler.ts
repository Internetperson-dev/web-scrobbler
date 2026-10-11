'use strict';

import type ClonedSong from '@/core/object/cloned-song';
import { ServiceCallResult } from '@/core/object/service-call-result';
import type { BaseSong } from '@/core/object/song';
import type { AudioScrobblerParams } from '@/core/scrobbler/audio-scrobbler/audio-scrobbler';
import AudioScrobbler from '@/core/scrobbler/audio-scrobbler/audio-scrobbler';
import type { ScrobblerSongInfo } from '@/core/scrobbler/base-scrobbler';
import {
	DIRECT_MATCH_LISTENER_FLOOR,
	pickBestTrackMatch,
	prepareSearchQuery,
	shouldImproveMatch,
} from '@/core/scrobbler/lastfm/lastfm-match';
import type {
	TrackMatchCandidate,
	TrackMatchQuery,
} from '@/core/scrobbler/lastfm/lastfm-match';
import type {
	LastFmTrackInfo,
	LastFmTrackSearchResponse,
} from '@/core/scrobbler/lastfm/lastfm.types';
import { createArtistURL, removeMetadataDecorations } from '@/util/util';
import { sendBackgroundMessage } from '@/util/communication';

/**
 * Module for all communication with Last.FM
 */
export default class LastFmScrobbler extends AudioScrobbler {
	/** @override */
	getApiUrl(): string {
		return 'https://ws.audioscrobbler.com/2.0/';
	}

	/** @override */
	getApiKey(): string {
		return 'd9bb1870d3269646f740544d9def2c95';
	}

	/** @override */
	getApiSecret(): string {
		return '2160733a567d4a1a69a73fad54c564b2';
	}

	/** @override */
	getBaseAuthUrl(): string {
		return 'https://www.last.fm/api/auth/';
	}

	/** @override */
	getBaseProfileUrl(): string {
		return 'https://last.fm/user/';
	}

	/** @override */
	getId(): string {
		return 'lastfm';
	}

	/** @override */
	getLabel(): 'Last.fm' {
		return 'Last.fm';
	}

	/** @override */
	getStatusUrl(): string {
		return 'http://status.last.fm/';
	}

	/** @override */
	getStorageName(): 'LastFM' {
		return 'LastFM';
	}

	/** @override */
	async getSongInfo(song: ClonedSong): Promise<ScrobblerSongInfo> {
		const data = await this.resolveSongInfo(song);

		if (this.canLoveSong() && data) {
			sendBackgroundMessage(song.controllerTabId, {
				type: 'updateLove',
				payload: {
					isLoved: data.userloved || false,
				},
			});
		}

		return data;
	}

	/**
	 * Load song info for a song reported by a connector.
	 *
	 * Last.fm is first asked about the track exactly as it was reported.
	 * If the track is unknown, or if the found entry does not resemble the
	 * reported one (e.g. because the title contains junk like "ft. …", the
	 * artist was resolved to an obscure compilation of the track, or the
	 * entry is too unpopular to be the canonical one), Last.fm search is
	 * used to find the track with the closest title, preferring the most
	 * popular version of it.
	 *
	 * @param song - Song object
	 * @returns Song info
	 * @throws Error if Last.fm does not know the track
	 */
	private async resolveSongInfo(
		song: ClonedSong,
	): Promise<ScrobblerSongInfo> {
		const query: TrackMatchQuery = {
			artist: song.getArtist(),
			track: song.getTrack(),
		};
		const album = song.getAlbum() || undefined;
		const sessionName = await this.getSessionName();

		const directInfo = await this.fetchTrackInfo(query, album, sessionName);
		const directData = directInfo ? this.parseSongInfo(directInfo) : null;

		if (
			directInfo &&
			directData &&
			!shouldImproveMatch(
				query,
				directInfo.track.artist.name,
				directInfo.track.name,
			) &&
			(parseInt(directInfo.track.listeners) || 0) >=
				DIRECT_MATCH_LISTENER_FLOOR
		) {
			return directData;
		}

		const directMatch: TrackMatchCandidate | null = directInfo
			? {
					artist: directInfo.track.artist.name,
					name: directInfo.track.name,
					listeners: parseInt(directInfo.track.listeners) || 0,
					url: directInfo.track.url,
				}
			: null;

		const match = await this.searchTrackMatch(query, directMatch);
		if (!match) {
			if (directData) {
				return directData;
			}
			throw new Error('Unable to load song info');
		}

		if (
			directData &&
			directMatch &&
			directMatch.artist === match.artist &&
			directMatch.name === match.name
		) {
			return directData;
		}

		this.debugLog(
			`Resolved "${query.artist} - ${query.track}" to ` +
				`"${match.artist} - ${match.name}"`,
		);

		const matchedInfo = await this.fetchTrackInfo(
			{ artist: match.artist, track: match.name },
			album,
			sessionName,
		);

		if (matchedInfo) {
			return this.parseSongInfo(matchedInfo);
		}
		if (directData) {
			return directData;
		}
		return this.songInfoFromMatch(match);
	}

	/**
	 * Search Last.fm for a track that better matches the reported track
	 * info than the entry found by a direct lookup.
	 *
	 * @param query - Track info reported by the connector
	 * @param directMatch - Entry found by a direct lookup, if any
	 * @returns Best matching track, or null if there is no good match
	 */
	private async searchTrackMatch(
		query: TrackMatchQuery,
		directMatch: TrackMatchCandidate | null,
	): Promise<TrackMatchCandidate | null> {
		const searchQuery = prepareSearchQuery(query.track ?? '');
		if (!searchQuery) {
			return null;
		}

		const withDirectMatch = (matches: TrackMatchCandidate[]) => {
			return directMatch ? [...matches, directMatch] : matches;
		};

		let match = pickBestTrackMatch(
			withDirectMatch(await this.searchTracks(searchQuery)),
			query,
		);

		if (!match && query.artist) {
			/*
			 * The search above only used the track title, because the
			 * reported artist may be a channel or an uploader name. If it
			 * gave nothing, search again, this time letting Last.fm use
			 * the artist as well.
			 */
			const searchArtist = removeMetadataDecorations(query.artist);
			match = pickBestTrackMatch(
				withDirectMatch(
					await this.searchTracks(searchQuery, searchArtist),
				),
				query,
			);
		}

		return match;
	}

	/**
	 * Request track info from Last.fm.
	 *
	 * @param query - Artist and track to look up
	 * @param album - Album reported by the connector, if any
	 * @param sessionName - Last.fm session name, if authorized
	 * @returns Response data, or null if the track is unknown
	 */
	private async fetchTrackInfo(
		query: TrackMatchQuery,
		album: string | undefined,
		sessionName: string | undefined,
	): Promise<LastFmTrackInfo | null> {
		if (!query.artist || !query.track) {
			return null;
		}

		const params: AudioScrobblerParams = {
			method: 'track.getinfo',
			track: query.track,
			artist: query.artist,
		};

		if (album) {
			params.album = album;
		}
		if (sessionName) {
			params.username = sessionName;
		}

		try {
			const responseData = await this.sendRequest<LastFmTrackInfo>(
				{ method: 'GET' },
				params,
				false,
			);

			if (
				this.processResponse(responseData) !==
				ServiceCallResult.RESULT_OK
			) {
				return null;
			}

			return responseData.track ? responseData : null;
		} catch {
			// The track is unknown or the request has failed
			return null;
		}
	}

	/**
	 * Search for tracks matching the given query.
	 *
	 * @param track - Track title to search for
	 * @param artist - Artist to limit the search to
	 * @returns List of found tracks
	 */
	private async searchTracks(
		track: string,
		artist?: string,
	): Promise<TrackMatchCandidate[]> {
		const params: AudioScrobblerParams = {
			method: 'track.search',
			track,
			limit: '30',
		};

		if (artist) {
			params.artist = artist;
		}

		let responseData: LastFmTrackSearchResponse;
		try {
			responseData = await this.sendRequest<LastFmTrackSearchResponse>(
				{ method: 'GET' },
				params,
				false,
			);
		} catch {
			return [];
		}

		if (
			this.processResponse(responseData) !== ServiceCallResult.RESULT_OK
		) {
			return [];
		}

		const matches = responseData.results?.trackmatches?.track;
		if (!matches) {
			return [];
		}

		const matchList = Array.isArray(matches) ? matches : [matches];
		return matchList
			.filter((match) => Boolean(match.artist && match.name))
			.map((match) => {
				return {
					artist: match.artist,
					name: match.name,
					listeners: parseInt(match.listeners ?? '') || 0,
					url: match.url,
				};
			});
	}

	/**
	 * Get the name of the authorized Last.fm user, if any.
	 *
	 * @returns Session name, or undefined if the user is not authorized
	 */
	private async getSessionName(): Promise<string | undefined> {
		try {
			const { sessionName } = await this.getSession();
			return sessionName;
		} catch {
			return undefined;
		}
	}

	/**
	 * Build song info from a search result; used when Last.fm cannot
	 * provide full info about the found track.
	 *
	 * @param match - Track found using Last.fm search
	 * @returns Parsed song info
	 */
	private songInfoFromMatch(match: TrackMatchCandidate): ScrobblerSongInfo {
		return {
			artist: match.artist,
			artistUrl: createArtistURL(match.artist),

			track: match.name,
			trackUrl: match.url ?? '',

			duration: null,

			userPlayCount: 0,
		};
	}

	/** @override */
	canLoadSongInfo(): boolean {
		return true;
	}

	/**
	 * Parse service response and return parsed data.
	 * @param responseData - Last.fm track.getInfo response data
	 * @returns Parsed song info
	 */
	public parseSongInfo(responseData: LastFmTrackInfo): ScrobblerSongInfo {
		const songInfo: Partial<ScrobblerSongInfo> = {};

		const trackInfo = responseData.track;
		const albumInfo = responseData.track.album;
		const artistInfo = responseData.track.artist;
		const userlovedStatus = trackInfo.userloved;

		if (userlovedStatus) {
			songInfo.userloved = userlovedStatus === '1';
		} else {
			songInfo.userloved = undefined;
		}

		songInfo.artist = artistInfo.name;
		songInfo.artistUrl = artistInfo.url;

		songInfo.track = trackInfo.name;
		songInfo.trackUrl = trackInfo.url;

		songInfo.duration = parseInt(trackInfo.duration) / 1000 || null;

		if (albumInfo) {
			songInfo.album = albumInfo.title;
			songInfo.albumUrl = albumInfo.url;
			songInfo.albumMbId = albumInfo.mbid;

			if (Array.isArray(albumInfo.image)) {
				/*
				 * Convert an array from response to an object.
				 * Format is the following: { size: "url", ... }.
				 */
				const images = albumInfo.image.reduce(
					(result, image) => {
						result[image.size] = image['#text'];
						return result;
					},
					{} as Record<string, string>,
				);

				const imageSizes = ['extralarge', 'large', 'medium'];

				for (const imageSize of imageSizes) {
					const url = images[imageSize];
					if (url) {
						songInfo.trackArtUrl = url;
						break;
					}
				}
			}
		}

		songInfo.userPlayCount = parseInt(trackInfo.userplaycount) || 0;

		return songInfo as ScrobblerSongInfo;
	}

	/** @override */
	applyFilter(song: BaseSong): BaseSong {
		/**
		 * Last.fm rejects track if album artist contains more then just "Various Artists"
		 */
		if (song.getAlbumArtist()) {
			const albumArtist = song.getAlbumArtist() || '';

			song.parsed.albumArtist = albumArtist.includes('Various Artists')
				? 'Various Artists'
				: albumArtist;
		}

		return song;
	}
}
