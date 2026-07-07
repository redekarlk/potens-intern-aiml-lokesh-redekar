// controllers/ingest.js

import path from 'path';
import { fileURLToPath } from 'url';
import pool from '../config/db.js';
import { ingestDirectory } from '../services/ingest.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runIngestion(req, res) {
	try {
		const docsDir = path.resolve(__dirname, '../../data/source_docs');
		const results = await ingestDirectory(docsDir);
		res.json({ message: 'Ingestion complete', results });
	} catch (err) {
		console.error('Error in ingest controller:', err.message);
		res.status(500).json({ error: 'Ingestion failed' });
	}
}

export async function listDocuments(req, res) {
	try {
		const result = await pool.query(
			'SELECT id, filename, title, domain, chunk_count, uploaded_at FROM documents ORDER BY id'
		);
		res.json(result.rows);
	} catch (err) {
		console.error('Error in list documents controller:', err.message);
		res.status(500).json({ error: 'Failed to list documents' });
	}
}
