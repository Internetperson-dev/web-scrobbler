export interface LastFmImage {
	size: string;
	'#text': string;
}

export interface LastFmTag {
	name: string;
	url: string;
}

export interface LastFmTrackSearchMatch extends Record<string, unknown> {
	artist: string;
	name: string;
	url: string;
	mbid: string;
	listeners?: string;
	image?: LastFmImage[];
}

export interface LastFmTrackSearchResponse extends Record<string, unknown> {
	results?: {
		trackmatches?: {
			track?: LastFmTrackSearchMatch | LastFmTrackSearchMatch[];
		};
	};
}

export interface LastFmTrackInfo extends Record<string, unknown> {
	track: {
		name: string;
		mbid: string;
		url: string;
		duration: string;
		streamable: { '#text': string; fulltrack: string };
		listeners: string;
		playcount: string;
		artist: {
			name: string;
			mbid: string;
			url: string;
		};
		album: {
			artist: string;
			title: string;
			mbid: string;
			url: string;
			'@attr': { position: string };
			image: LastFmImage[];
		};
		userplaycount: string;
		userloved: string;
		toptags: { tag: LastFmTag[] };
		wiki?: {
			published: string;
			summary: string;
			content: string;
		};
	};
}
