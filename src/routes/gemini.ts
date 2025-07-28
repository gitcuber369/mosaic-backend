import express from 'express';
import { handleGeminiRequest } from '../controllers/geminiController';

const router = express.Router();

router.post('/', handleGeminiRequest);

export default router; 