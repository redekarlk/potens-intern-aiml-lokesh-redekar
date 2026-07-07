// chunker.js - splits document text into overlapping chunks for embedding

const CHUNK_SIZE = 500; // tokens (approx)
const OVERLAP = 75;

function estimateTokens(text) {
	return Math.ceil(text.length / 4);
}

function splitSentences(text) {
	const raw = text.match(/[^.!?]+[.!?]+[\s]*/g);
	if (!raw) return [text.trim()];
	return raw.map((s) => s.trim()).filter((s) => s.length > 0);
}

// detect section headings and split the document into sections
function splitSections(text) {
	const lines = text.split('\n');
	const sections = [];
	let heading = 'Introduction';
	let buffer = [];

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const nextLine = lines[i + 1] || '';

		const isMdHeading = /^#{1,4}\s+/.test(line);
		const isUnderline = /^[=-]{3,}$/.test(nextLine) && line.trim().length > 0;

		if (isMdHeading || isUnderline) {
			if (buffer.length > 0) {
				sections.push({ heading, text: buffer.join('\n').trim() });
				buffer = [];
			}
			heading = line.replace(/^#+\s*/, '').trim();
			if (isUnderline) i++;
			continue;
		}

		buffer.push(line);
	}

	if (buffer.length > 0) {
		sections.push({ heading, text: buffer.join('\n').trim() });
	}

	return sections;
}

// chunk a section into overlapping pieces, respecting sentence boundaries
function chunkSection(sectionText, maxTokens, overlapTokens) {
	const paragraphs = sectionText.split(/\n\n+/).filter((p) => p.trim());
	const sentences = [];
	for (const para of paragraphs) {
		sentences.push(...splitSentences(para));
	}

	if (sentences.length === 0) return [];

	const chunks = [];
	let start = 0;

	while (start < sentences.length) {
		let count = 0;
		let end = start;

		while (end < sentences.length) {
			const tokens = estimateTokens(sentences[end]);
			if (count + tokens > maxTokens && end > start) break;
			count += tokens;
			end++;
		}

		const text = sentences.slice(start, end).join(' ').trim();
		if (text.length > 0) chunks.push(text);

		// calculate overlap
		let overlapCount = 0;
		let overlapStart = end;
		while (overlapStart > start) {
			overlapStart--;
			overlapCount += estimateTokens(sentences[overlapStart]);
			if (overlapCount >= overlapTokens) break;
		}

		start = overlapStart > start ? overlapStart : end;
		if (start === end && end >= sentences.length) break;
		if (start === end) start = end;
	}

	return chunks;
}

export function chunkDocument(text, filename, options = {}) {
	const maxTokens = options.chunkSize || CHUNK_SIZE;
	const overlapTokens = options.overlap || OVERLAP;

	const sections = splitSections(text);
	const results = [];
	let idx = 0;
	let charOffset = 0;

	for (const section of sections) {
		const chunks = chunkSection(section.text, maxTokens, overlapTokens);

		for (const chunk of chunks) {
			const charStart = text.indexOf(chunk.substring(0, 50), charOffset);

			results.push({
				content: chunk,
				section_ref: section.heading,
				chunk_index: idx,
				token_count: estimateTokens(chunk),
				metadata: {
					filename,
					section_heading: section.heading,
					char_start: Math.max(charStart, 0),
					char_end: charStart >= 0 ? charStart + chunk.length : charOffset + chunk.length,
				},
			});

			if (charStart >= 0) charOffset = charStart;
			idx++;
		}
	}

	return results;
}
