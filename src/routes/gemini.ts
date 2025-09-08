import express from 'express';
import { handleGeminiRequest } from '../controllers/geminiController';
import { authenticateToken } from '../middleware/auth';

const router = express.Router();

// Gemini route (protected)
router.post('/', authenticateToken, handleGeminiRequest);

export default router;