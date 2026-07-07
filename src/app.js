import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import morgan from 'morgan';
import { connectDB } from './config/db.js';

import askRouter from './routes/ask.js';
import contradictRouter from './routes/contradict.js';
import ingestRouter from './routes/ingest.js';
import documentsRouter from './routes/documents.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

connectDB();

app.get('/', (req, res) => {
	res.json({ message: 'Backend is running' });
});

app.use('/ask', askRouter);
app.use('/contradict', contradictRouter);
app.use('/ingest', ingestRouter);
app.use('/documents', documentsRouter);

// error handler
app.use((err, req, res, next) => {
	console.error(err.stack);
	res.status(500).json({ error: 'Something went wrong' });
});

app.listen(port, () => {
	console.log(`Server running on ${port}`);
});