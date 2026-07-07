import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
	host: process.env.DB_HOST,
	port: process.env.DB_PORT,
	user: process.env.DB_USER,
	password: process.env.DB_PASSWORD,
	database: process.env.DB_NAME,
});

export const connectDB = async () => {
	try {
		await pool.query('SELECT 1');
		console.log('Database connected!');
	} catch (error) {
		console.error('Database connection failed:', error.message);
		process.exit(1);
	}
};

export default pool;