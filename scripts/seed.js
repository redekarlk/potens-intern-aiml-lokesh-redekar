import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { ingestDirectory } from '../src/services/ingest.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const docsDir = path.resolve(__dirname, '../data/source_docs');

console.log('Starting document ingestion...');
console.log(`Source directory: ${docsDir}`);

ingestDirectory(docsDir)
	.then(() => {
		console.log('Seeding complete');
		process.exit(0);
	})
	.catch((err) => {
		console.error('Seeding failed:', err.message);
		process.exit(1);
	});
