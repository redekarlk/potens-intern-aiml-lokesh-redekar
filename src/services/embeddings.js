// embeddings.js - wraps Gemini text-embedding-004

import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'text-embedding-004' });

const BATCH_SIZE = 10;
const BATCH_DELAY = 500; // ms between batches for rate limiting

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// embed a single query string
export async function embedText(text) {
	const result = await model.embedContent(text);
	return result.embedding.values;
}

// embed multiple texts in batches (used during ingestion)
export async function embedBatch(texts) {
	const embeddings = [];

	for (let i = 0; i < texts.length; i += BATCH_SIZE) {
		const batch = texts.slice(i, i + BATCH_SIZE);

		const results = await Promise.all(
			batch.map((text) => model.embedContent(text))
		);

		for (const r of results) {
			embeddings.push(r.embedding.values);
		}

		if (i + BATCH_SIZE < texts.length) {
			await sleep(BATCH_DELAY);
		}
	}

	return embeddings;
}
