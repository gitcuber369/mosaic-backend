import express from 'express';
import { handleTextToSpeech } from '../controllers/elevenlabsController';

const router = express.Router();

router.post('/text-to-speech', handleTextToSpeech);

export default router; 