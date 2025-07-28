import axios from 'axios';
import type { Request, Response } from 'express';

export const handleTextToSpeech = async (req: Request, res: Response) => {
  const { text, voice } = req.body;

  if (!text || !voice) {
    return res.status(400).json({ error: 'Text and voice are required' });
  }

  try {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'Missing ElevenLabs API key in environment variables' });
    }

    const response = await axios.post(
      `https://api.elevenlabs.io/v1/text-to-speech/${voice}`,
      {
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.4,
          similarity_boost: 0.6
        }
      },
      {
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg'
        },
        responseType: 'arraybuffer'
      }
    );

    res.set('Content-Type', 'audio/mpeg');
    res.send(response.data);
  } catch (error: any) {
    res.status(500).json({
      error: error?.response?.data || error.message || 'Failed to fetch from ElevenLabs API'
    });
  }
}; 