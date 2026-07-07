import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from '../src/config/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const runMigration = async () => {
	try {
		const sqlPath = path.join(__dirname, '001_init.sql');
		const sql = fs.readFileSync(sqlPath, 'utf-8');

		await pool.query(sql);

		console.log('Migration completed successfully');
		process.exit(0);
	} catch (error) {
		console.error('Migration failed:', error.message);
		process.exit(1);
	}
};

runMigration();