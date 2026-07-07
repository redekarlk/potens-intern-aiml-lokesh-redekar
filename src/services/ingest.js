import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import pool from '../config/db.js';
import { chunkDocument } from './chunker.js';
import { embedBatch } from './embeddings.js';

const require = createRequire(import.meta.url);
const pdf = require('pdf-parse');

export async function ingestDocument(filepath) {
	const filename = path.basename(filepath);

	// skip if already ingested
	const existing = await pool.query('SELECT id FROM documents WHERE filename = $1', [filename]);
	if (existing.rows.length > 0) {
		console.log(`Skipping ${filename} - already ingested`);
		return { filename, chunks: 0, skipped: true };
	}

	let text = '';
	let pagePositions = [];
	if (filename.toLowerCase().endsWith('.pdf')) {
		const buffer = fs.readFileSync(filepath);
		const parser = new pdf.PDFParse({ data: buffer });
		const result = await parser.getText();
		text = result.text;
	} else {
		text = fs.readFileSync(filepath, 'utf-8');
	}

	// Extract page positions and map index boundaries
	const pageRegex = /--\s*(\d+)\s*of\s*\d+\s*--/g;
	let match;
	while ((match = pageRegex.exec(text)) !== null) {
		pagePositions.push({
			page: parseInt(match[1], 10),
			rawIndex: match.index
		});
	}

	// Strip markers and collapse excess lines preserving character offsets
	text = text
		.replace(/--\s*\d+\s*of\s*\d+\s*--/g, (m) => ' '.repeat(m.length))
		.replace(/\n{3,}/g, (m) => '\n\n' + ' '.repeat(m.length - 2));

	console.log(`Processing ${filename} (${text.length} chars)`);

	// chunk the document passing pagePositions
	const chunks = chunkDocument(text, filename, { pagePositions });
	console.log(`  ${chunks.length} chunks created`);

	// embed all chunks
	const texts = chunks.map((c) => c.content);
	const embeddings = await embedBatch(texts);
	console.log(`  ${embeddings.length} embeddings generated`);

	// determine domain based on filename
	const isAiDoc = filename.toLowerCase().includes('ai') || filename.toLowerCase().includes('oecd');
	const domain = isAiDoc ? 'ai_governance' : 'cloud_databases';

	// store in db using a transaction
	const client = await pool.connect();
	try {
		await client.query('BEGIN');

		const title = filename.replace(/\.(txt|pdf)$/i, '').replace(/_/g, ' ').replace(/[-\s]+/g, ' ');
		const docResult = await client.query(
			`INSERT INTO documents (filename, title, domain, chunk_count)
			 VALUES ($1, $2, $3, $4) RETURNING id`,
			[filename, title, domain, chunks.length]
		);
		const docId = docResult.rows[0].id;

		for (let i = 0; i < chunks.length; i++) {
			await client.query(
				`INSERT INTO chunks (document_id, chunk_index, content, section_ref, metadata, token_count, embedding)
				 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
				[docId, chunks[i].chunk_index, chunks[i].content, chunks[i].section_ref,
				 JSON.stringify(chunks[i].metadata), chunks[i].token_count, embeddings[i]]
			);
		}

		await client.query('COMMIT');
		console.log(`  Saved to db (doc id: ${docId})`);

		return { filename, chunks: chunks.length, skipped: false };
	} catch (err) {
		await client.query('ROLLBACK');
		throw err;
	} finally {
		client.release();
	}
}

export async function ingestDirectory(dirPath) {
	const files = fs.readdirSync(dirPath)
		.filter((f) => f.endsWith('.txt') || f.endsWith('.pdf'))
		.sort();
	console.log(`Found ${files.length} documents`);

	const results = [];
	for (let i = 0; i < files.length; i++) {
		console.log(`\nIngesting ${i + 1}/${files.length}: ${files[i]}`);
		const result = await ingestDocument(path.join(dirPath, files[i]));
		results.push(result);
	}

	const ingested = results.filter((r) => !r.skipped);
	const totalChunks = ingested.reduce((sum, r) => sum + r.chunks, 0);
	console.log(`\nDone: ${ingested.length} ingested, ${results.length - ingested.length} skipped, ${totalChunks} chunks total`);

	return results;
}
