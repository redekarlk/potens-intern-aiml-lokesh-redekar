// embeddings.js - wraps Vertex or Gemini embeddings through the unified Gen AI SDK

import { getAiClient } from './aiClient.js';

const BATCH_SIZE = 5;
const BATCH_DELAY = 1000; // ms between batches

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// retry helper for handling API rate limits (429)
async function callWithRetry(fn, retries = 10, delay = 5000) {
	try {
		return await fn();
	} catch (err) {
		const message = err?.message || '';
		if (message.includes('429') && retries > 0) {
			console.warn(`Rate limited (429). Retrying in ${delay}ms... (${retries} retries left)`);
			await sleep(delay);
			return callWithRetry(fn, retries - 1, delay * 2);
		}
		throw err;
	}
}

// embed a single query string
export async function embedText(text) {
	const result = await callWithRetry(() =>
		getAiClient().models.embedContent({
			model: process.env.AI_EMBEDDING_MODEL || 'text-embedding-004',
			contents: text,
		})
	);
	return result.embeddings?.[0]?.values || [];
}

// embed multiple texts in batches (used during ingestion)
export async function embedBatch(texts) {
	const embeddings = [];
	const BATCH_SIZE = 30; // Safe batch size for text-embedding-004

	for (let i = 0; i < texts.length; i += BATCH_SIZE) {
		const batch = texts.slice(i, i + BATCH_SIZE);

		const result = await callWithRetry(() =>
			getAiClient().models.embedContent({
				model: process.env.AI_EMBEDDING_MODEL || 'text-embedding-004',
				contents: batch,
			})
		);

		if (result.embeddings) {
			for (const emb of result.embeddings) {
				embeddings.push(emb.values || []);
			}
		}

		if (i + BATCH_SIZE < texts.length) {
			await sleep(2000); // 2s pause between batches
		}
	}

	return embeddings;
}
