// controllers/ask.js

import { embedText } from '../services/embeddings.js';
import { retrieveChunks } from '../services/retrieval.js';
import { generateAnswer, assessConfidence } from '../services/llm.js';
import { processQueryLanguage, translateAnswer } from '../services/translate.js';

export async function askQuestion(req, res) {
	try {
		const { question } = req.body;

		if (!question || question.trim().length === 0) {
			return res.status(400).json({ error: 'question is required' });
		}

		const { detectedLang, englishQuery } = await processQueryLanguage(question);
		const queryEmbedding = await embedText(englishQuery);
		const chunks = await retrieveChunks(queryEmbedding);

		if (chunks.length === 0) {
			const notCovered = 'The provided documents do not cover this topic.';
			const translated = await translateAnswer(notCovered, detectedLang);

			return res.json({
				answer: translated,
				language: detectedLang,
				citations: [],
				confidence: 0,
				covered: false,
			});
		}

		const result = await generateAnswer(englishQuery, chunks);
		const finalAnswer = await translateAnswer(result.answer, detectedLang);

		const maxSimilarity = Math.max(...chunks.map((c) => c.similarity_score));
		const llmConfidence = await assessConfidence(englishQuery, result.answer, chunks);
		const confidence = parseFloat((0.6 * maxSimilarity + 0.4 * llmConfidence).toFixed(2));

		res.json({
			answer: finalAnswer,
			language: detectedLang,
			citations: result.citations.map((c) => ({
				...c,
				similarity_score: chunks.find((ch) => ch.filename === c.source_file)?.similarity_score || null,
			})),
			confidence,
			covered: result.covered,
		});
	} catch (err) {
		console.error('Error in ask controller:', err.message);
		res.status(500).json({ error: 'Failed to process question' });
	}
}
