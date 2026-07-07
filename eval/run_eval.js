import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { embedText } from '../src/services/embeddings.js';
import { retrieveChunks } from '../src/services/retrieval.js';
import { processQueryLanguage } from '../src/services/translate.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runEval() {
	console.log('Starting RAG Retrieval Evaluation (top-k = 5)...');
	console.log('==================================================');

	const qaPairsPath = path.join(__dirname, 'qa_pairs.json');
	const qaPairs = JSON.parse(fs.readFileSync(qaPairsPath, 'utf-8'));

	let hits = 0;
	let totalValid = 0; // count only "covered" and "multilingual" questions
	let guardrailSuccess = 0;
	let totalUncovered = 0;

	const results = [];

	for (const pair of qaPairs) {
		const { id, question, expected_sources, type } = pair;

		// 1. handle language processing
		const { englishQuery } = await processQueryLanguage(question);

		// 2. embed query
		const embedding = await embedText(englishQuery);

		// 3. retrieve
		const chunks = await retrieveChunks(embedding, { topK: 5, textQuery: englishQuery });
		const retrievedSources = [...new Set(chunks.map((c) => c.filename))];

		if (type === 'uncovered') {
			totalUncovered++;
			const correctlyBlocked = chunks.length === 0;
			if (correctlyBlocked) {
				guardrailSuccess++;
			}
			results.push({
				id,
				type,
				question: question.substring(0, 40) + '...',
				expected: 'None (Out of domain)',
				retrieved: retrievedSources.join(', ') || 'None (Blocked)',
				status: correctlyBlocked ? 'PASS - Correctly Blocked' : 'FAIL - Hallucination risk',
			});
		} else {
			totalValid++;
			// Hit check: did the retrieved chunks contain at least one expected document?
			const isHit = expected_sources.some((src) => retrievedSources.includes(src));
			if (isHit) {
				hits++;
			}

			results.push({
				id,
				type,
				question: question.substring(0, 40) + '...',
				expected: expected_sources.join(', '),
				retrieved: retrievedSources.join(', ') || 'None',
				status: isHit ? 'Hit' : 'Miss',
			});
		}
	}

	console.table(results);

	const hitRate = (hits / totalValid) * 100;
	const guardrate = (guardrailSuccess / totalUncovered) * 100;

	console.log('\n==================================================');
	console.log('Evaluation Summary:');
	console.log(`- Retrieval Hit Rate (top-5): ${hitRate.toFixed(1)}% (${hits}/${totalValid})`);
	console.log(`- Hallucination Guardrail Correctness: ${guardrate.toFixed(1)}% (${guardrailSuccess}/${totalUncovered})`);
	console.log('==================================================');

	process.exit(0);
}

runEval().catch((err) => {
	console.error('Evaluation run failed:', err);
	process.exit(1);
});
