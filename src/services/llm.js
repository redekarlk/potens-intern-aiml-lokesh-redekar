import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const config = {
	temperature: 0.2,
	topP: 0.8,
	maxOutputTokens: 2048,
};

// generate an answer grounded in the retrieved chunks
export async function generateAnswer(query, chunks) {
	const context = chunks
		.map((c, i) => `[Chunk ${i + 1}] Source: ${c.filename} | Section: ${c.section_ref}\n${c.content}`)
		.join('\n\n---\n\n');

	const systemPrompt = `You are a document Q&A assistant. Answer ONLY using the provided context chunks.

Rules:
1. Use ONLY information from the context. No outside knowledge.
2. Cite every claim using [Source: filename, Section: section_name].
3. If the context doesn't cover the question, say: "The provided documents do not cover this topic."
4. Don't speculate or add info not in the chunks.
5. If only partial info is available, answer what you can and note what's missing.

Respond in JSON:
{
  "answer": "your answer with citations",
  "citations": [{"source_file": "filename", "section_ref": "section", "snippet": "quote from chunk"}],
  "covered": true/false,
  "confidence": 0.XX
}`;

	const model = genAI.getGenerativeModel({
		model: 'gemini-flash-latest',
		systemInstruction: systemPrompt,
		generationConfig: config,
	});

	const result = await model.generateContent(`Context:\n\n${context}\n\nQuestion: ${query}`);
	const text = result.response.text();

	return parseAnswer(text, chunks);
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

	const model = genAI.getGenerativeModel({
		model: 'gemini-flash-latest',
		systemInstruction: systemPrompt,
		generationConfig: { ...config, maxOutputTokens: 4096 },
	});

	const result = await model.generateContent(`Document A:\n\n${docA}\n\n---\n\nDocument B:\n\n${docB}`);
	const text = result.response.text();

	return parseContradiction(text);
}

// confidence assessment (stretch goal)
export async function assessConfidence(query, answer, chunks) {
	const summary = chunks
		.map((c) => `[${c.filename}]: ${c.content.substring(0, 200)}...`)
		.join('\n');

	const model = genAI.getGenerativeModel({
		model: 'gemini-flash-latest',
		generationConfig: { temperature: 0.1, maxOutputTokens: 100 },
	});

	try {
		const result = await model.generateContent(
			`Rate how well this answer is grounded in the context (0.0 to 1.0).\n\nContext:\n${summary}\n\nQ: ${query}\nA: ${answer}\n\nRespond with ONLY: {"confidence": 0.XX}`
		);
		const match = result.response.text().match(/\{[\s\S]*?"confidence"[\s\S]*?\}/);
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

function parseAnswer(text, chunks) {
	const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
	try {
		const parsed = JSON.parse(cleaned);
		return {
			answer: parsed.answer || text,
			citations: parsed.citations || [],
			covered: parsed.covered !== undefined ? parsed.covered : true,
			confidence: parsed.confidence !== undefined ? parsed.confidence : null,
		};
	} catch {
		return {
			answer: text,
			citations: chunks.map((c) => ({
				source_file: c.filename,
				section_ref: c.section_ref,
				snippet: c.content.substring(0, 150),
			})),
			covered: true,
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
		return { has_conflict: false, reasoning: text, conflicts: [] };
	}
}
