/**
 * This pipeline stage normalizes track info fields.
 */
import Song from '@/core/object/song';
import { removeMetadataDecorations } from '@/util/util';

/**
 * Fields that may contain site-specific decorations, e.g. "(Official
 * Video)", that are not a part of the actual metadata.
 */
const CLEANED_FIELDS = new Set(['artist', 'track']);

/**
 * Normalize info fields of given track.
 * @param song - Song object
 */
export function process(song: Song): void {
	for (const field of Song.BASE_FIELDS) {
		const fieldValue = song.processed[field];
		if (typeof fieldValue === 'string' && fieldValue) {
			let normalizedValue = fieldValue.normalize();

			if (CLEANED_FIELDS.has(field)) {
				normalizedValue = removeMetadataDecorations(normalizedValue);
			}

			song.processed[field] = normalizedValue;
			song.noRegex[field] = normalizedValue;
		}
	}
}
