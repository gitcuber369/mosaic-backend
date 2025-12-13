import axios from 'axios';
import type { Request, Response } from 'express';

export const handleGeminiRequest = async (req: Request, res: Response) => {
  const prompt = req.body.prompt;

  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  try {
    const apiKey = process.env.GENMNI_API;

    if (!apiKey) {
      return res.status(500).json({ error: 'Missing Gemini API key in environment variables' });
    }

    const response = await axios.post(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
      {
        contents: [{ parts: [{ text: prompt }] }]
      },
      {
        params: { key: apiKey },
        headers: { 'Content-Type': 'application/json' }
      }
    );

    res.json(response.data);
  } catch (error: any) {
    res.status(500).json({
      error: error?.response?.data || error.message || 'Failed to fetch from Gemini API'
    });
  }
};
