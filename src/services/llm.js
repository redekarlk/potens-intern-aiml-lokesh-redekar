import { getAiClient } from './aiClient.js';

const config = {
	temperature: 0.2,
	topP: 0.8,
	maxOutputTokens: 2048,
};

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callWithRetry(fn, retries = 5, delay = 2000) {
	try {
		return await fn();
	} catch (err) {
		const message = err?.message || '';
		if (message.includes('429') && retries > 0) {
			console.warn(`LLM Rate limited (429). Retrying in ${delay}ms... (${retries} retries left)`);
			await sleep(delay);
			return callWithRetry(fn, retries - 1, delay * 2);
		}
		throw err;
	}
}

// generate an answer grounded in the retrieved chunks
export async function generateAnswer(query, chunks) {
	// Number chunks AFTER filtering \u2014 these are the exact [1]..[N] the LLM must use
	const numberedContext = chunks
		.map((c, i) => `[${i + 1}] Source: ${c.filename} | Section: ${c.section_ref} | Relevance: ${(c.similarity_score * 100).toFixed(0)}%\n${c.content}`)
		.join('\n\n---\n\n');

	const n = chunks.length;

	const systemPrompt = `You are a strict document Q&A assistant. You answer ONLY using the numbered excerpts provided by the user.

HARD RULES — follow every one without exception:
1. Do NOT use any outside knowledge, even if you recognise the topic. If the excerpts don't fully answer the question, say so explicitly rather than filling gaps from your training data.
2. Every factual claim in your answer MUST be traceable to a specific excerpt. Cite it with [N] inline.
3. Only cite numbers from [1] to [${n}]. There are exactly ${n} excerpt(s). Do not invent or skip numbers.
4. If none of the excerpts address the question, return covered: false and answer: "The provided documents do not cover this topic."
5. If only partial information is available, answer what the excerpts support and note what is missing.
6. Rate your confidence in the answer's groundedness between 0.0 (completely ungrounded/refusal) and 1.0 (completely grounded in excerpts).
7. Pay close attention to negative constraints, differences, and exact wording. If a query asks if a definition requires a specific detail (e.g. "human-defined"), check if the specific definition excerpt asked about actually includes that exact word. Do not conflate similar definitions from different documents (e.g., NIST vs. OECD).
8. If a detail is only present in one source but omitted in another, do not assert that the detail applies to both sources. Answer accurately based on the specific source asked about.

Respond in JSON matching the specified schema.`;

	const userContent = `Excerpts:\n\n${numberedContext}\n\nQuestion: ${query}`;

	const modelName = process.env.AI_TEXT_MODEL || 'gemini-2.5-flash';

	const result = await callWithRetry(() =>
		getAiClient().models.generateContent({
			model: modelName,
			contents: userContent,
			config: {
				systemInstruction: systemPrompt,
				temperature: config.temperature,
				topP: config.topP,
				maxOutputTokens: config.maxOutputTokens,
				responseMimeType: 'application/json',
				responseSchema: {
					type: 'object',
					properties: {
						answer: { type: 'string' },
						citations: {
							type: 'array',
							items: { type: 'integer' }
						},
						covered: { type: 'boolean' },
						confidence: {
							type: 'number',
							description: 'Groundedness confidence score between 0.0 (not grounded) and 1.0 (perfectly grounded)'
						}
					},
					required: ['answer', 'citations', 'covered', 'confidence']
				}
			},
		})
	);

	if (result.candidates?.[0]?.finishReason === 'MAX_TOKENS') {
		console.warn('[LLM Service] Warning: Answer was truncated due to token limit (MAX_TOKENS)');
	}

	const text = result.text || '';

	return parseAnswer(text, chunks, query);
}

// detect contradictions between two documents
export async function detectContradictions(chunksA, chunksB, topic = null) {
	const format = (chunks, label) =>
		chunks.map((c, i) => `[${label} - ${i + 1}] ${c.filename} | ${c.section_ref}\n${c.content}`).join('\n\n');

	const docA = format(chunksA, 'Doc A');
	const docB = format(chunksB, 'Doc B');

	const topicLine = topic
		? `Focus on: "${topic}".`
		: 'Compare all topics in both documents.';

	const systemPrompt = `You analyze documents for contradictions.

Rules:
1. Find claims in Doc A that directly conflict with claims in Doc B.
2. Differences in scope are NOT contradictions. Only flag genuine conflicts.
3. Quote exact text from each document for each conflict.
4. If no contradictions exist, say so.
${topicLine}

Respond in JSON:
{
  "has_conflict": true/false,
  "reasoning": "summary",
  "conflicts": [{"topic": "...", "excerpt_a": {"source": "file", "text": "quote"}, "excerpt_b": {"source": "file", "text": "quote"}, "explanation": "why they conflict"}]
}`;

	const modelName = process.env.AI_TEXT_MODEL || 'gemini-2.5-flash';

	const result = await callWithRetry(() =>
		getAiClient().models.generateContent({
			model: modelName,
			contents: `Document A:\n\n${docA}\n\n---\n\nDocument B:\n\n${docB}`,
			config: {
				systemInstruction: systemPrompt,
				temperature: config.temperature,
				topP: config.topP,
				maxOutputTokens: 4096,
				responseMimeType: 'application/json',
			},
		})
	);
	const text = result.text || '';

	return parseContradiction(text);
}

// confidence assessment (stretch goal)
export async function assessConfidence(query, answer, chunks) {
	const summary = chunks
		.map((c) => `[${c.filename}]: ${c.content.substring(0, 200)}...`)
		.join('\n');
	const modelName = process.env.AI_TEXT_MODEL || 'gemini-2.5-flash';

	try {
		const result = await callWithRetry(() =>
			getAiClient().models.generateContent({
				model: modelName,
				contents: `Rate how well this answer is grounded in the context (0.0 to 1.0).\n\nContext:\n${summary}\n\nQ: ${query}\nA: ${answer}\n\nRespond with ONLY: {"confidence": 0.XX}`,
				config: {
					temperature: 0.1,
					maxOutputTokens: 100,
					responseMimeType: 'application/json',
				},
			})
		);
		const match = (result.text || '').match(/\{[\s\S]*?"confidence"[\s\S]*?\}/);
		if (match) {
			const parsed = JSON.parse(match[0]);
			return Math.min(1, Math.max(0, parsed.confidence));
		}
	} catch (err) {
		console.error('Confidence check failed:', err.message);
	}
	return 0.5;
}

// --- parsing helpers ---

function trimSnippet(content, maxLen = 200, query = '') {
	const cleaned = content.replace(/^p\.\s*\d+\s*\n+/i, '').trim();
	if (cleaned.length <= maxLen) return cleaned;

	// Split into sentences.
	const sentences = cleaned.split(/(?<=[.!?])\s+/);

	if (sentences.length <= 1 || !query) {
		return fallbackTruncate(cleaned, maxLen);
	}

	const STOPWORDS = new Set([
		'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
		'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'about', 'against', 'between', 'into',
		'through', 'during', 'before', 'after', 'above', 'below', 'from', 'up', 'down', 'in', 'out',
		'off', 'over', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where',
		'why', 'how', 'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such',
		'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 's', 't', 'can',
		'will', 'just', 'should', 'now', 'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those'
	]);

	const queryWords = query.toLowerCase()
		.replace(/[^a-z0-9\s]/g, '')
		.split(/\s+/)
		.filter(w => w.length > 2 && !STOPWORDS.has(w));

	if (queryWords.length === 0) {
		return fallbackTruncate(cleaned, maxLen);
	}

	let bestIndex = 0;
	let maxScore = -1;

	sentences.forEach((sentence, idx) => {
		const sentenceWords = new Set(
			sentence.toLowerCase()
				.replace(/[^a-z0-9\s]/g, '')
				.split(/\s+/)
		);

		let score = 0;
		queryWords.forEach(qw => {
			if (sentenceWords.has(qw)) {
				score += 1;
			}
		});

		if (score > maxScore) {
			maxScore = score;
			bestIndex = idx;
		}
	});

	if (maxScore <= 0) {
		bestIndex = 0;
	}

	let snippet = '';
	let currentIdx = bestIndex;

	while (currentIdx < sentences.length) {
		const nextSec = sentences[currentIdx];
		if (snippet.length + nextSec.length + (snippet ? 1 : 0) <= maxLen) {
			snippet += (snippet ? ' ' : '') + nextSec;
			currentIdx++;
		} else {
			break;
		}
	}

	if (!snippet) {
		const targetSentence = sentences[bestIndex];
		snippet = targetSentence.slice(0, maxLen);
		const lastEnd = Math.max(
			snippet.lastIndexOf('.'),
			snippet.lastIndexOf('!'),
			snippet.lastIndexOf('?')
		);
		snippet = lastEnd > 40 ? snippet.slice(0, lastEnd + 1) : snippet + '...';
	} else if (currentIdx < sentences.length) {
		snippet += '...';
	}

	return snippet;
}

function fallbackTruncate(text, maxLen) {
	if (text.length <= maxLen) return text;
	const truncated = text.slice(0, maxLen);
	const lastEnd = Math.max(
		truncated.lastIndexOf('.'),
		truncated.lastIndexOf('!'),
		truncated.lastIndexOf('?')
	);
	return lastEnd > 40 ? truncated.slice(0, lastEnd + 1) : truncated + '...';
}

function sanitizeInlineCitations(answerText, maxValid) {
	let occurred = false;
	const sanitized = answerText.replace(/\[(\d+(?:\s*,\s*\d+)*)\]/g, (match, nums) => {
		const parsedNums = nums.split(',').map(n => parseInt(n.trim(), 10));
		const valid = parsedNums.filter(n => n >= 1 && n <= maxValid);
		if (valid.length < parsedNums.length) {
			occurred = true;
		}
		if (valid.length === 0) return '';
		return `[${valid.join(', ')}]`;
	});
	if (occurred) {
		console.warn(`[LLM Service] Warning: Model generated out-of-range citation numbers (max valid: ${maxValid}) — sanitized.`);
	}
	return sanitized;
}

function parseAnswer(text, chunks, query = '') {
	const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
	try {
		const parsed = JSON.parse(cleaned);

		// Map all context chunks in the exact order they were passed to the LLM,
		// so that [N] in the answer text always matches citations[N-1].
		const citations = chunks.map((chunk) => ({
			source_file: chunk.filename,
			section_ref: chunk.section_ref,
			snippet: trimSnippet(chunk.content.replace(/^p\.\s*\d+\s*\n+/i, ''), 200, query),
			similarity_score: chunk.similarity_score
		}));

		let rawConfidence = parsed.confidence;
		if (typeof rawConfidence === 'number') {
			if (rawConfidence > 5.0 && rawConfidence <= 100.0) {
				rawConfidence = rawConfidence / 100.0;
			} else if (rawConfidence > 1.0 && rawConfidence <= 5.0) {
				rawConfidence = rawConfidence / 5.0;
			}
			rawConfidence = Math.min(1.0, Math.max(0.0, rawConfidence));
		} else {
			rawConfidence = null;
		}

		const finalAnswer = sanitizeInlineCitations(parsed.answer || text, chunks.length);

		return {
			answer: finalAnswer,
			citations: citations,
			covered: parsed.covered !== undefined ? parsed.covered : true,
			confidence: rawConfidence,
		};
	} catch {
		console.warn('[LLM Service] Answer JSON parsing failed (possibly truncated), attempting regex extraction...');
		let answerStr = '';
		const answerMatch = cleaned.match(/"answer"\s*:\s*"([\s\S]*?)(?="|$)/);
		if (answerMatch) {
			answerStr = answerMatch[1]
				.replace(/\\"/g, '"')
				.replace(/\\n/g, '\n')
				.trim();
			if (answerStr.endsWith('\\')) {
				answerStr = answerStr.slice(0, -1);
			}
		} else {
			answerStr = text; // Fallback to raw text
		}

		return {
			answer: sanitizeInlineCitations(answerStr, chunks.length),
			citations: chunks.map((c) => ({
				source_file: c.filename,
				section_ref: c.section_ref,
				snippet: trimSnippet(c.content.replace(/^p\.\s*\d+\s*\n+/i, ''), 200, query),
				similarity_score: c.similarity_score,
			})),
			covered: true,
			confidence: 0.5
		};
	}
}

function parseContradiction(text) {
	const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
	try {
		const parsed = JSON.parse(cleaned);
		return {
			has_conflict: parsed.has_conflict || false,
			reasoning: parsed.reasoning || '',
			conflicts: parsed.conflicts || [],
		};
	} catch {
		console.warn('[LLM Service] Contradiction JSON parsing failed (possibly truncated), attempting regex extraction...');

		let hasConflict = false;
		const conflictMatch = cleaned.match(/"has_conflict"\s*:\s*(true|false)/i);
		if (conflictMatch) {
			hasConflict = conflictMatch[1].toLowerCase() === 'true';
		}

		let reasoning = '';
		const reasoningMatch = cleaned.match(/"reasoning"\s*:\s*"([\s\S]*?)(?="|$)/);
		if (reasoningMatch) {
			reasoning = reasoningMatch[1]
				.replace(/\\"/g, '"')
				.replace(/\\n/g, '\n')
				.trim();
			if (reasoning.endsWith('\\')) {
				reasoning = reasoning.slice(0, -1);
			}
		} else {
			reasoning = cleaned;
		}

		return {
			has_conflict: hasConflict,
			reasoning: reasoning,
			conflicts: [],
		};
	}
}
