import type { Request, Response } from 'express';
import { getStoriesCollection, getUsersCollection } from '../db';
import { ObjectId } from 'mongodb';
import axios from 'axios';
import { v2 as cloudinary } from 'cloudinary';
import OpenAI from 'openai';
cloudinary.config({
  cloud_name: 'dyhjoenm7',
  api_key: '334143462565599',
  api_secret: 'qaWAqE96QdHRCv1OKduW_jhr2Fc',
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function createStory(req: Request, res: Response) {
  try {
    const { userId, style, voice, rating, name, character, gender, ageGroup, hobbies } = req.body;
    let voiceId = 'EXAVITQu4vr4xnSDxMaL'; // fallback
    if (voice && /^[a-zA-Z0-9]{20,}$/.test(voice)) {
      voiceId = voice;
    } else if (voice && voice.toLowerCase().includes('female')) {
      voiceId = '21m00Tcm4TlvDq8ikWAM'; // Rachel (female)
    } else if (voice && voice.toLowerCase().includes('male')) {
      voiceId = 'pNInz6obpgDQGcFmaJgB'; // Adam (male)
    }
    if (!userId || !style || !name || !character || !gender || !ageGroup || !hobbies) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Deduct 1 story creation credit from user (atomic update)
    const users = getUsersCollection();
    const updateResult = await users.updateOne(
      { _id: new ObjectId(userId), storyCreationCredits: { $gt: 0 } },
      { $inc: { storyCreationCredits: -1 } }
    );
    if (updateResult.modifiedCount === 0) {
      return res.status(403).json({ error: 'No story creation credits left' });
    }

    // Generate all story content at once (introduction + all chapters)
    let storyContent = null;
    try {
      const prompt = `Create a complete children's story in JSON format with the following structure:
{
  "introduction": {
    "title": "Introduction",
    "description": "A brief description of what this chapter covers",
    "text": "Introduction text here (exactly 500 characters)"
  },
  "chapters": [
    {
      "title": "The Challenge",
      "description": "A brief description of the challenge chapter",
      "text": "Chapter 1 text here (exactly 500 characters)"
    },
    {
      "title": "The Journey", 
      "description": "A brief description of the journey chapter",
      "text": "Chapter 2 text here (exactly 500 characters)"
    },
    {
      "title": "The Lesson",
      "description": "A brief description of the lesson chapter",
      "text": "Chapter 3 text here (exactly 500 characters)"
    }
  ]
}

The story should be in the ${style} style for a ${ageGroup} ${gender.toLowerCase()} named ${name}. This character is described as "${character}" and enjoys ${hobbies.join(", ")}.

Make it creative, engaging, and age-appropriate. Avoid mature or scary content. The tone should be heartwarming, educational, and suitable for bedtime or classroom reading.

IMPORTANT: Each text field must be exactly 500 characters. Count carefully and ensure no chapter exceeds 500 characters.

Return ONLY the JSON object, no additional text.`;

      const completion = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: 'You are a creative children\'s story writer. Always respond with valid JSON only.' },
          { role: 'user', content: prompt },
        ],
        max_tokens: 2000,
        temperature: 0.8,
      });
      
      if (completion.choices && completion.choices[0] && completion.choices[0].message && typeof completion.choices[0].message.content === 'string') {
        const content = completion.choices[0].message.content.trim();
        // Try to parse the JSON response
        try {
          storyContent = JSON.parse(content);
        } catch (parseError) {
          console.error('Failed to parse JSON response:', content);
          return res.status(500).json({ error: 'Failed to parse story content', details: parseError });
        }
      } else {
        return res.status(500).json({ error: 'No content received from OpenAI' });
      }
    } catch (err) {
      return res.status(500).json({ error: 'Failed to generate story content', details: err });
    }

    // Generate image with DALL-E (OpenAI)
    let imageUrl = '';
    try {
      const imagePrompt = `A beautiful illustration for a children's story: ${character}, in the style of ${style}, vibrant colors, storybook art.`;
      const imageRes = await openai.images.generate({
        prompt: imagePrompt,
        n: 1,
        size: '512x512',
        response_format: 'url',
      });
      if (imageRes && Array.isArray(imageRes.data) && imageRes.data[0] && typeof imageRes.data[0].url === 'string') {
        const imageBufferRes = await axios.get(imageRes.data[0].url, { responseType: 'arraybuffer' });
        const imageBuffer = Buffer.from(imageBufferRes.data);
        imageUrl = await new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload(`data:image/png;base64,${imageBuffer.toString('base64')}`,
            { resource_type: 'image', format: 'png', folder: 'stories_images' },
            (error, result) => {
              if (error) return reject(error);
              if (!result) return reject(new Error('No result from Cloudinary upload'));
              resolve(result.secure_url);
            }
          );
        });
      } else {
        imageUrl = '';
      }
    } catch (err) {
      return res.status(500).json({ error: 'Failed to generate or upload image', details: err });
    }

    // Create chapters array with all text content (no audio yet)
    const chapters = [
      {
        title: storyContent.introduction.title,
        description: storyContent.introduction.description,
        text: storyContent.introduction.text,
        audioUrl: '', // Will be generated on-demand
        generated: true, // Text is generated, audio is not
        audioGenerated: false, // Track audio generation separately
      },
      ...storyContent.chapters.map((chapter: any, index: number) => ({
        title: chapter.title,
        description: chapter.description,
        text: chapter.text,
        audioUrl: '', // Will be generated on-demand
        generated: true, // Text is generated, audio is not
        audioGenerated: false, // Track audio generation separately
      }))
    ];

    // Save story with all text content
    const stories = getStoriesCollection();
    const result = await stories.insertOne({
      userId: new ObjectId(userId),
      style,
      voice: voiceId,
      image: imageUrl,
      rating: typeof rating === 'number' ? rating : 3.0,
      createdAt: new Date(),
      chapters,
      ageGroup,
      gender,
      name,
      character,
      hobbies,
    });

    res.status(201).json({
      success: true,
      storyId: result.insertedId,
      chapters: chapters.map(c => ({ 
        title: c.title, 
        text: c.text,
        generated: c.generated,
        audioGenerated: c.audioGenerated 
      })),
      image: imageUrl,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create story', details: err });
  }
}

export async function getUserStories(req: Request, res: Response) {
  try {
    console.log('🔍 getUserStories called with params:', req.params);
    console.log('🔍 getUserStories called with query:', req.query);
    
    const { userId } = req.params;
    if (!userId) return res.status(400).json({ error: 'userId required' });
    
    console.log('🔍 Looking for stories with userId:', userId);
    const stories = getStoriesCollection();
    const userStories = await stories.find({ userId: new ObjectId(userId as string) }).sort({ createdAt: -1 }).toArray();
    
    console.log('✅ Found stories:', userStories.length);
    res.status(200).json(userStories);
  } catch (err) {
    console.error('❌ Error in getUserStories:', err);
    res.status(500).json({ error: 'Failed to fetch stories', details: err });
  }
}

export async function getStoryById(req: Request, res: Response) {
  try {
    console.log('🔍 getStoryById called with params:', req.params);
    console.log('🔍 getStoryById called with query:', req.query);
    
    const { id } = req.params;
    const userId = req.query.userId || req.headers['x-user-id'];
    if (!id) return res.status(400).json({ error: 'id required' });
    
    console.log('🔍 Looking for story with id:', id);
    const stories = getStoriesCollection();
    const story = await stories.findOne({ _id: new ObjectId(id) });
    if (!story) return res.status(404).json({ error: 'Story not found' });
    
    // Only deduct credits if this is a public story access (not for chapter pages)
    // For chapter pages, we handle credit deduction separately
    if (userId && story.userId && story.userId.toString() !== String(userId) && !req.query.skipCreditDeduction) {
      const users = getUsersCollection();
      const updateResult = await users.updateOne(
        { _id: new ObjectId(String(userId)), storyListenCredits: { $gt: 0 } },
        { $inc: { storyListenCredits: -1 } }
      );
      if (updateResult.modifiedCount === 0) {
        return res.status(403).json({ error: 'No story listen credits left' });
      }
    }
    res.status(200).json(story);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch story', details: err });
  }
}

export async function generateChapter(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { chapterNumber } = req.body;
    if (!id || typeof chapterNumber !== 'number' || chapterNumber < 0 || chapterNumber > 3) {
      return res.status(400).json({ error: 'Invalid story id or chapter number (must be 0-3)' });
    }
    const stories = getStoriesCollection();
    const story = await stories.findOne({ _id: new ObjectId(id) });
    if (!story) return res.status(404).json({ error: 'Story not found' });
    if (!story.chapters || !story.chapters[chapterNumber]) {
      return res.status(400).json({ error: 'Chapter not found in story' });
    }
    
    const chapter = story.chapters[chapterNumber];
    
    // If audio is already generated, return it
    if (chapter.audioGenerated && chapter.audioUrl) {
      return res.status(200).json({ 
        chapter: chapter, 
        alreadyGenerated: true 
      });
    }
    
    // If text is not generated, return error
    if (!chapter.generated || !chapter.text) {
      return res.status(400).json({ error: 'Chapter text not found' });
    }
    
    // Generate audio for the chapter
    let chapterAudioUrl = '';
    try {
      const openaiTTSRes = await axios.post(
        'https://api.openai.com/v1/audio/speech',
        {
          model: 'tts-1',
          input: chapter.text,
          voice: 'alloy',
          response_format: 'mp3'
        },
        {
          headers: {
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
          },
          responseType: 'arraybuffer'
        }
      );
      const audioBuffer = Buffer.from(openaiTTSRes.data);
      chapterAudioUrl = await new Promise((resolve, reject) => {
        cloudinary.uploader.upload(
          `data:audio/mp3;base64,${audioBuffer.toString('base64')}`,
          { resource_type: 'video', format: 'mp3', folder: 'stories_audio' },
          (error, result) => {
            if (error) return reject(error);
            if (!result) return reject(new Error('No result from Cloudinary upload'));
            resolve(result.secure_url);
          }
        );
      });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to generate or upload chapter audio', details: err });
    }
    
    // Update the chapter with audio URL
    const update = {
      $set: {
        [`chapters.${chapterNumber}.audioUrl`]: chapterAudioUrl,
        [`chapters.${chapterNumber}.audioGenerated`]: true,
      }
    };
    await stories.updateOne({ _id: new ObjectId(id) }, update);
    
    // Return the updated chapter
    res.status(200).json({
      chapter: {
        title: chapter.title,
        text: chapter.text,
        audioUrl: chapterAudioUrl,
        generated: chapter.generated,
        audioGenerated: true,
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate chapter audio', details: err });
  }
}

export async function getPaginatedStories(req: Request, res: Response) {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 5;
    const skip = (page - 1) * limit;
    const storiesCollection = getStoriesCollection();
    const stories = await storiesCollection.find({})
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();
    const total = await storiesCollection.countDocuments();
    res.json({
      stories,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch paginated public stories', details: err });
  }
} 

export async function deleteStory(req: Request, res: Response) {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'Missing story id' });
    const stories = getStoriesCollection();
    const result = await stories.deleteOne({ _id: new ObjectId(id) });
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Story not found' });
    }
    res.status(200).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete story', details: err });
  }
} 