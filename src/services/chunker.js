const CHUNK_SIZE = 500; // tokens (approx)
const OVERLAP = 75;

function estimateTokens(text) {
	return Math.ceil(text.length / 4);
}

function splitSentences(text) {
	const raw = text.match(/[^.!?\s][^.!?]*(?:[.!?](?![\d])(?:[\s]|$)+)/g);
	if (!raw) return [text.trim()];
	return raw.map((s) => s.trim()).filter((s) => s.length > 0);
}

function cleanText(text) {
	return text.replace(/\.{3,}/g, ' ');
}

function splitSections(text) {
	const lines = text.split('\n');
	const sections = [];
	let heading = 'Introduction';
	let buffer = [];

	const isHeading = (line, nextLine) => {
		// 1. MD heading
		if (/^#{1,4}\s+/.test(line)) return true;

		// 2. Underlined heading
		if (/^[=-]{3,}$/.test(nextLine) && line.trim().length > 0) return true;

		const trimmed = line.trim();
		if (trimmed.length === 0 || trimmed.length > 80) return false;

		// 3. Numbered section headings: "5.3 Measure", "1.1 Goal", "MEASURE 1:"
		if (/^(\d+\.\d+(\.\d+)?)\s+[A-Z]/.test(trimmed)) return true;
		if (/^(GOVERN|MAP|MEASURE|MANAGE)\s+\d+/.test(trimmed)) return true;
		if (/^(Table|Figure)\s+\d+:/.test(trimmed)) return true;

		// 4. Large capitalized headings like "PART 1: FOUNDATION" or "APPENDIX A"
		if (/^(PART|APPENDIX|SECTION)\s+\d+/i.test(trimmed)) return true;

		return false;
	};

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const nextLine = lines[i + 1] || '';

		const isMd = /^#{1,4}\s+/.test(line);
		const isUnder = /^[=-]{3,}$/.test(nextLine) && line.trim().length > 0;

		if (isHeading(line, nextLine)) {
			if (buffer.length > 0) {
				sections.push({ heading, text: buffer.join('\n').trim() });
				buffer = [];
			}
			heading = line.replace(/^#+\s*/, '').trim();
			if (isUnder) i++;
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
	const pagePositions = options.pagePositions || [];

	const cleaned = cleanText(text);
	const sections = splitSections(cleaned);
	const results = [];
	let idx = 0;
	let charOffset = 0;

	for (const section of sections) {
		const chunks = chunkSection(section.text, maxTokens, overlapTokens);

		for (const chunk of chunks) {
			const charStart = cleaned.indexOf(chunk.substring(0, 50), charOffset);

			// Determine page number based on charStart
			let pageNum = null;
			if (pagePositions.length > 0) {
				pageNum = pagePositions[0].page;
				for (const pos of pagePositions) {
					if (pos.rawIndex <= charStart) {
						pageNum = pos.page;
					} else {
						break;
					}
				}
			}

			// Fall back to page number if section heading is 'Introduction' or generic
			let sectionRef = section.heading;
			if ((sectionRef === 'Introduction' || !sectionRef) && pageNum !== null) {
				sectionRef = `p. ${pageNum}`;
			}

			const prependedContent = `${sectionRef}\n\n${chunk}`;

			results.push({
				content: prependedContent,
				section_ref: sectionRef,
				chunk_index: idx,
				token_count: estimateTokens(prependedContent),
				metadata: {
					filename,
					section_heading: sectionRef,
					char_start: Math.max(charStart, 0),
					char_end: charStart >= 0 ? charStart + chunk.length : charOffset + chunk.length,
					page: pageNum
				},
			});

			if (charStart >= 0) charOffset = charStart;
			idx++;
		}
	}

	return results;
}
