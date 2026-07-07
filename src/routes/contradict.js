import { Router } from 'express';
import { checkContradictions } from '../controllers/contradict.js';

const router = Router();

router.post('/', checkContradictions);

export default router;
