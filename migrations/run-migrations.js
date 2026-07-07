import fs from 'fs';
import pool from '../src/config/db.js';

const runMigration = async () => {
	try {
		const sql = fs.readFileSync('./migrations/001_init.sql', 'utf-8');

		await pool.query(sql);

		console.log('Migration completed successfully');
		process.exit(0);
	} catch (error) {
		console.error('Migration failed:', error.message);
		process.exit(1);
	}
};

runMigration();