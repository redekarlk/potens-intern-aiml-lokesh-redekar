// retrieval.js - cosine similarity search over stored embeddings

import dotenv from 'dotenv';
import pool from '../config/db.js';

dotenv.config();

const SIMILARITY_THRESHOLD = parseFloat(process.env.SIMILARITY_THRESHOLD || '0.45');
const TOP_K = parseInt(process.env.TOP_K || '5', 10);

function cosineSimilarity(a, b) {
	if (a.length !== b.length) return 0;

	let dot = 0, normA = 0, normB = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		normA += a[i] * a[i];
		normB += b[i] * b[i];
	}

	const denom = Math.sqrt(normA) * Math.sqrt(normB);
	return denom === 0 ? 0 : dot / denom;
}

// find the top-K most relevant chunks for a query embedding
// returns empty array if nothing clears the similarity threshold
export async function retrieveChunks(queryEmbedding, options = {}) {
	const topK = options.topK || TOP_K;
	const docIds = options.docIds || null;

	let query = `
		SELECT c.id AS chunk_id, c.document_id, c.content, c.section_ref,
		       c.chunk_index, c.token_count, c.metadata, c.embedding,
		       d.filename
		FROM chunks c
		JOIN documents d ON c.document_id = d.id
	`;
	const params = [];

	if (docIds && docIds.length > 0) {
		query += ` WHERE c.document_id = ANY($1)`;
		params.push(docIds);
	}

	const result = await pool.query(query, params);

	const scored = result.rows
		.filter((row) => row.embedding && row.embedding.length > 0)
		.map((row) => {
			const emb = typeof row.embedding === 'string'
				? JSON.parse(row.embedding)
				: row.embedding;

			return {
				chunk_id: row.chunk_id,
				document_id: row.document_id,
				filename: row.filename,
				section_ref: row.section_ref,
				content: row.content,
				chunk_index: row.chunk_index,
				token_count: row.token_count,
				metadata: row.metadata,
				similarity_score: cosineSimilarity(queryEmbedding, emb),
			};
		});

	return scored
		.filter((s) => s.similarity_score >= SIMILARITY_THRESHOLD)
		.sort((a, b) => b.similarity_score - a.similarity_score)
		.slice(0, topK);
}

// get all chunks for specific documents (used by /contradict)
export async function getChunksByDocIds(docIds) {
	const result = await pool.query(
		`SELECT c.id AS chunk_id, c.document_id, c.content, c.section_ref,
		        c.chunk_index, c.metadata, d.filename
		 FROM chunks c
		 JOIN documents d ON c.document_id = d.id
		 WHERE c.document_id = ANY($1)
		 ORDER BY c.document_id, c.chunk_index`,
		[docIds]
	);
	return result.rows;
}
