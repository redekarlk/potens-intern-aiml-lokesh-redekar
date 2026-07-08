// controllers/ask.js

import { embedText } from '../services/embeddings.js';
import { retrieveChunks } from '../services/retrieval.js';
import { generateAnswer, assessConfidence } from '../services/llm.js';
import { processQueryLanguage, translateAnswer } from '../services/translate.js';

export async function askQuestion(req, res) {
	const tStart = Date.now();
	try {
		const { question, doc_ids } = req.body;

		if (!question || question.trim().length === 0) {
			return res.status(400).json({ error: 'question is required' });
		}

		const tLangStart = Date.now();
		const { detectedLang, englishQuery } = await processQueryLanguage(question);
		const tLangTime = Date.now() - tLangStart;

		const tEmbedStart = Date.now();
		const queryEmbedding = await embedText(englishQuery);
		const tEmbedTime = Date.now() - tEmbedStart;

		const tRetrieveStart = Date.now();
		// Pass englishQuery for Hybrid Search, doc_ids, and default topK to 5
		let chunks = await retrieveChunks(queryEmbedding, {
			textQuery: englishQuery,
			docIds: Array.isArray(doc_ids) ? doc_ids.map(Number) : null,
			topK: 5
		});
		const tRetrieveTime = Date.now() - tRetrieveStart;

		if (chunks.length === 0) {
			const notCovered = 'The provided documents do not cover this topic.';
			const translated = await translateAnswer(notCovered, detectedLang);

			console.log(`[Ask Question] Response: Out of domain. Total Time: ${Date.now() - tStart}ms (Lang: ${tLangTime}ms, Embed: ${tEmbedTime}ms, Retrieve: ${tRetrieveTime}ms)`);
			return res.json({
				answer: translated,
				language: detectedLang,
				citations: [],
				confidence: null,
				covered: false,
			});
		}

		// chunks from retrieval are already filtered by RELEVANCE_THRESHOLD —
		// log what we have and proceed directly to generation.
		const maxSimilarity = Math.max(...chunks.map((c) => c.similarity_score));
		console.log(`[Ask Question] ${chunks.length} chunk(s) passed relevance filter (max similarity: ${maxSimilarity.toFixed(4)})`);

		const tLlmStart = Date.now();
		const result = await generateAnswer(englishQuery, chunks);
		const tLlmTime = Date.now() - tLlmStart;

		const tTransStart = Date.now();
		const finalAnswer = await translateAnswer(result.answer, detectedLang);
		const tTransTime = Date.now() - tTransStart;

		// Use model-generated confidence if present, otherwise calculate it
		let llmConfidence = result.confidence;
		if (llmConfidence === null || llmConfidence === undefined) {
			llmConfidence = await assessConfidence(englishQuery, result.answer, chunks);
		}

		const confidence = result.covered
			? parseFloat((0.6 * maxSimilarity + 0.4 * llmConfidence).toFixed(2))
			: null;

		const totalTime = Date.now() - tStart;
		console.log(`[Ask Question] Success. Total Time: ${totalTime}ms (Lang: ${tLangTime}ms, Embed: ${tEmbedTime}ms, Retrieve: ${tRetrieveTime}ms, LLM: ${tLlmTime}ms, Trans: ${tTransTime}ms)`);

		res.json({
			answer: finalAnswer,
			language: detectedLang,
			citations: result.citations,
			confidence,
			covered: result.covered,
		});
	} catch (err) {
		console.error('Error in ask controller:', err.message);
		if (err.message.includes('429') || err.status === 429) {
			return res.status(429).json({
				error: 'The AI provider rate limit was exceeded. Please try again later or check your Vertex/Gemini quota.',
			});
		}
		res.status(500).json({ error: 'Failed to process question' });
	}
}
