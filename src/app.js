import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import morgan from 'morgan';
import { connectDB } from './config/db.js';


dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

connectDB(); //calling database

app.get('/', (req, res) => {
	res.json({
		message: 'Backend is running',
	});
});


app.listen(port, () => {
	console.log(`Server running on ${port}`);
});