import { Router } from 'express';
import { askQuestion } from '../controllers/ask.js';

const router = Router();

router.post('/', askQuestion);

export default router;
