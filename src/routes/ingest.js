import { Router } from 'express';
import { runIngestion } from '../controllers/ingest.js';

const router = Router();

router.post('/', runIngestion);

export default router;
