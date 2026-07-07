// retrieval.js - cosine similarity search over stored embeddings

import dotenv from 'dotenv';
import pool from '../config/db.js';

dotenv.config();

const SIMILARITY_THRESHOLD = parseFloat(process.env.SIMILARITY_THRESHOLD || '0.45');
const RELEVANCE_THRESHOLD = parseFloat(process.env.RELEVANCE_THRESHOLD || '0.60');
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
	const textQuery = options.textQuery || null;

	let query = `
		SELECT c.id AS chunk_id, c.document_id, c.content, c.section_ref,
		       c.chunk_index, c.token_count, c.metadata, c.embedding,
		       d.filename
	`;
	const params = [];

	if (textQuery) {
		query += `, ts_rank_cd(c.content_tsv, plainto_tsquery('english', $1)) AS text_rank`;
		params.push(textQuery);
	} else {
		query += `, 0 AS text_rank`;
	}

	query += `
		FROM chunks c
		JOIN documents d ON c.document_id = d.id
	`;

	if (docIds && docIds.length > 0) {
		const paramIndex = params.length + 1;
		query += ` WHERE c.document_id = ANY($${paramIndex})`;
		params.push(docIds);
	}

	const result = await pool.query(query, params);

	const scored = result.rows
		.filter((row) => row.embedding && row.embedding.length > 0)
		.map((row) => {
			const emb = typeof row.embedding === 'string'
				? JSON.parse(row.embedding)
				: row.embedding;

			const simScore = cosineSimilarity(queryEmbedding, emb);
			const textRankVal = parseFloat(row.text_rank || '0');
			
			// Normalize textRankVal (ts_rank_cd is usually between 0.0 and 1.0 but clamp to 1.0 to be safe)
			const normalizedTextRank = Math.min(1.0, textRankVal);

			// Hybrid score combination: 70% semantic, 30% keyword match
			const hybridScore = 0.7 * simScore + 0.3 * normalizedTextRank;

			return {
				chunk_id: row.chunk_id,
				document_id: row.document_id,
				filename: row.filename,
				section_ref: row.section_ref,
				content: row.content,
				chunk_index: row.chunk_index,
				token_count: row.token_count,
				metadata: row.metadata,
				similarity_score: simScore,
				text_rank: textRankVal,
				hybrid_score: hybridScore,
			};
		});

	const sorted = scored
		.filter((s) => s.similarity_score >= SIMILARITY_THRESHOLD)
		.sort((a, b) => b.hybrid_score - a.hybrid_score);

	// Try to find chunks clearing the higher RELEVANCE_THRESHOLD first
	let sourcePool = sorted.filter((s) => s.similarity_score >= RELEVANCE_THRESHOLD);
	const usingRelevance = sourcePool.length > 0;
	if (!usingRelevance) {
		sourcePool = sorted; // Fallback to all above similarity threshold
	}

	// Implement Document Diversification to avoid single-document monopolization in top-K.
	const maxPerDoc = 2; // Capping to 2 chunks per document to promote diversity in multi-hop queries
	const selected = [];
	const docCounts = {};

	for (const chunk of sourcePool) {
		if (selected.length >= topK) break;
		const docId = chunk.document_id;
		docCounts[docId] = docCounts[docId] || 0;
		if (docCounts[docId] < maxPerDoc) {
			selected.push(chunk);
			docCounts[docId]++;
		}
	}

	// Fill remaining slots from the source pool if selected count is less than topK
	if (selected.length < topK) {
		for (const chunk of sourcePool) {
			if (selected.length >= topK) break;
			if (!selected.some(s => s.chunk_id === chunk.chunk_id)) {
				selected.push(chunk);
			}
		}
	}

	console.log(`[Retrieval] top-${topK} candidates: ${selected.length} returned (usingRelevance: ${usingRelevance})`);
	return selected;
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
