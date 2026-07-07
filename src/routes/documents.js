import { Router } from 'express';
import { listDocuments } from '../controllers/ingest.js';

const router = Router();

router.get('/', listDocuments);

export default router;
