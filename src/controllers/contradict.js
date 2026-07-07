// controllers/contradict.js

import { getChunksByDocIds } from '../services/retrieval.js';
import { detectContradictions } from '../services/llm.js';

export async function checkContradictions(req, res) {
	try {
		const { doc_id_a, doc_id_b, topic } = req.body;

		if (!doc_id_a || !doc_id_b) {
			return res.status(400).json({ error: 'doc_id_a and doc_id_b are required' });
		}

		const allChunks = await getChunksByDocIds([doc_id_a, doc_id_b]);
		const chunksA = allChunks.filter((c) => c.document_id === doc_id_a);
		const chunksB = allChunks.filter((c) => c.document_id === doc_id_b);

		if (chunksA.length === 0 || chunksB.length === 0) {
			return res.status(404).json({ error: 'One or both documents not found' });
		}

		const result = await detectContradictions(chunksA, chunksB, topic || null);
		res.json(result);
	} catch (err) {
		console.error('Error in contradict controller:', err.message);
		if (err.message.includes('429') || err.status === 429) {
			return res.status(429).json({
				error: 'The AI provider rate limit was exceeded. Please try again later or check your Vertex/Gemini quota.',
			});
		}
		res.status(500).json({ error: 'Failed to analyze contradictions' });
	}
}
