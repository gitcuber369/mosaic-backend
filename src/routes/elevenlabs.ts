import express from 'express';
import { handleTextToSpeech } from '../controllers/elevenlabsController';
import { authenticateToken } from '../middleware/auth';

const router = express.Router();

// ElevenLabs route (protected)
router.post('/text-to-speech', authenticateToken, handleTextToSpeech);

export default router;