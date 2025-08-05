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

    // Deduct 1 story listening credit from user (atomic update) - this covers both generation and listening
    const users = getUsersCollection();
    const updateResult = await users.updateOne(
      { _id: new ObjectId(userId), storyListenCredits: { $gt: 0 } },
      { $inc: { storyListenCredits: -1 } }
    );
    if (updateResult.modifiedCount === 0) {
      return res.status(403).json({ error: 'No story credits left' });
    }

    // 1. Generate Introduction (Chapter 0)
    let introText = '';
    let introTitle = '';
    let introDescription = '';
    try {
      const prompt = `Write the Introduction for a creative, engaging, and age-appropriate children's story in the ${style} style. The Introduction should be about 500 characters.\n\nThe story is for a ${ageGroup} ${gender.toLowerCase()} named ${name}. This character is described as \"${character}\" and enjoys ${hobbies.join(", ")}.\n\nThe Introduction should introduce ${name}'s world and personality. Make it imaginative, vivid, and fun. Avoid mature or scary content. The tone should be heartwarming, educational, and suitable for bedtime or classroom reading.\n\nPlease provide:\n1. A creative title for this introduction (2-4 words)\n2. A brief description (1 sentence, 10-15 words)\n3. The introduction text (about 500 characters)\n\nFormat your response as:\nTITLE: [title]\nDESCRIPTION: [description]\nTEXT: [introduction text]`;
      const completion = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: 'You are a creative children\'s story writer.' },
          { role: 'user', content: prompt },
        ],
        max_tokens: 800,
        temperature: 0.8,
      });
      if (completion.choices && completion.choices[0] && completion.choices[0].message && typeof completion.choices[0].message.content === 'string') {
        const content = completion.choices[0].message.content.trim();
        
        // Parse the response to extract title, description, and text
        const titleMatch = content.match(/TITLE:\s*(.+)/i);
        const descriptionMatch = content.match(/DESCRIPTION:\s*(.+)/i);
        const textMatch = content.match(/TEXT:\s*([\s\S]+)/i);
        
        introTitle = titleMatch ? titleMatch[1].trim() : 'Introduction';
        introDescription = descriptionMatch ? descriptionMatch[1].trim() : 'Meet our main character';
        introText = textMatch ? textMatch[1].trim() : content;
      } else {
        introTitle = 'Introduction';
        introDescription = 'Meet our main character';
        introText = '';
      }
    } catch (err) {
      return res.status(500).json({ error: 'Failed to generate introduction', details: err });
    }

    // 2. Generate Chapter 1
    let chapter1Text = '';
    let chapter1Title = '';
    let chapter1Description = '';
    try {
      const prompt = `Write Chapter 1 (The Challenge) for a creative, engaging, and age-appropriate children's story in the ${style} style. This chapter should be about 700 characters.\n\nThe story is for a ${ageGroup} ${gender.toLowerCase()} named ${name}. This character is described as \"${character}\" and enjoys ${hobbies.join(", ")}.\n\nChapter 1 should introduce a small conflict or adventure related to their hobbies or character. Make it imaginative, vivid, and fun. Avoid mature or scary content. The tone should be heartwarming, educational, and suitable for bedtime or classroom reading.\n\nPlease provide:\n1. A creative title for this chapter (2-4 words)\n2. A brief description (1 sentence, 10-15 words)\n3. The chapter text (about 700 characters)\n\nFormat your response as:\nTITLE: [title]\nDESCRIPTION: [description]\nTEXT: [chapter text]`;
      const completion = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: 'You are a creative children\'s story writer.' },
          { role: 'user', content: prompt },
        ],
        max_tokens: 800,
        temperature: 0.8,
      });
      if (completion.choices && completion.choices[0] && completion.choices[0].message && typeof completion.choices[0].message.content === 'string') {
        const content = completion.choices[0].message.content.trim();
        
        // Parse the response to extract title, description, and text
        const titleMatch = content.match(/TITLE:\s*(.+)/i);
        const descriptionMatch = content.match(/DESCRIPTION:\s*(.+)/i);
        const textMatch = content.match(/TEXT:\s*([\s\S]+)/i);
        
        chapter1Title = titleMatch ? titleMatch[1].trim() : 'The Challenge';
        chapter1Description = descriptionMatch ? descriptionMatch[1].trim() : 'A daring challenge begins';
        chapter1Text = textMatch ? textMatch[1].trim() : content;
      } else {
        chapter1Title = 'The Challenge';
        chapter1Description = 'A daring challenge begins';
        chapter1Text = '';
      }
    } catch (err) {
      return res.status(500).json({ error: 'Failed to generate chapter 1', details: err });
    }

    // 3. Generate image with DALL-E (OpenAI)
    let imageUrl = '';
    try {
      const imagePrompt = `${character}, illustrated in the style of ${style}. The scene is vibrant, magical, and full of childlike wonder. ${character} is depicted with expressive, friendly eyes and a joyful demeanor, surrounded by a richly detailed background that sparks imagination—such as talking trees, candy-colored clouds, or floating storybook islands. Use soft pastel tones or warm watercolor hues, gentle lighting, and whimsical proportions. The environment should evoke curiosity and comfort, like a scene straight from a bedtime storybook. The image should be full of charm, storytelling elements, and suitable for children aged 4–8. Include dynamic poses, playful details, and a sense of adventure or discovery.`;
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

    // 4. Generate audio for Introduction
    let introAudioUrl = '';
    try {
      const openaiTTSRes = await axios.post(
        'https://api.openai.com/v1/audio/speech',
        {
          model: 'tts-1',
          input: introText,
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
      // Use cloudinary.uploader.upload instead of upload_stream
      introAudioUrl = await new Promise((resolve, reject) => {
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
      return res.status(500).json({ error: 'Failed to generate or upload introduction audio', details: err });
    }

    // 5. Generate audio for Chapter 1
    let chapter1AudioUrl = '';
    try {
      const openaiTTSRes = await axios.post(
        'https://api.openai.com/v1/audio/speech',
        {
          model: 'tts-1',
          input: chapter1Text,
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
      chapter1AudioUrl = await new Promise((resolve, reject) => {
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
      return res.status(500).json({ error: 'Failed to generate or upload chapter 1 audio', details: err });
    }

    // 6. Save story with chapters array
    const stories = getStoriesCollection();
    const chapters = [
      {
        title: introTitle,
        description: introDescription,
        text: introText,
        audioUrl: introAudioUrl,
        generated: true,
      },
      {
        title: chapter1Title,
        description: chapter1Description,
        text: chapter1Text,
        audioUrl: chapter1AudioUrl,
        generated: true,
      },
      { title: 'The Journey', description: 'Journey through unknown lands', text: '', audioUrl: '', generated: false },
      { title: 'The Lesson', description: 'A lesson is learned', text: '', audioUrl: '', generated: false },
    ];
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
      chapters: chapters.map((c, i) => i < 2 ? c : { title: c.title, generated: false }),
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
    if (!id || typeof chapterNumber !== 'number' || chapterNumber < 2 || chapterNumber > 3) {
      return res.status(400).json({ error: 'Invalid story id or chapter number (must be 2 or 3)' });
    }
    const stories = getStoriesCollection();
    const story = await stories.findOne({ _id: new ObjectId(id) });
    if (!story) return res.status(404).json({ error: 'Story not found' });
    if (!story.chapters || !story.chapters[chapterNumber]) {
      return res.status(400).json({ error: 'Chapter not found in story' });
    }
    if (story.chapters[chapterNumber].generated) {
      return res.status(200).json({ chapter: story.chapters[chapterNumber], alreadyGenerated: true });
    }
    // Prepare prompt for the chapter
    let prompt = '';
    let defaultTitle = '';
    if (chapterNumber === 2) {
      defaultTitle = 'The Journey';
      prompt = `Write Chapter 2 (The Journey) for a creative, engaging, and age-appropriate children's story in the ${story.style} style. This chapter should be about 700 characters.\n\nThe story is for a ${story.ageGroup} ${story.gender?.toLowerCase() || ''} named ${story.name}. This character is described as \"${story.character}\" and enjoys ${story.hobbies?.join(", ") || ''}.\n\nChapter 2 should describe how the character faces the challenge. Make it imaginative, vivid, and fun. Avoid mature or scary content. The tone should be heartwarming, educational, and suitable for bedtime or classroom reading.\n\nPlease provide:\n1. A creative title for this chapter (2-4 words)\n2. A brief description (1 sentence, 10-15 words)\n3. The chapter text (about 700 characters)\n\nFormat your response as:\nTITLE: [title]\nDESCRIPTION: [description]\nTEXT: [chapter text]`;
    } else if (chapterNumber === 3) {
      defaultTitle = 'The Lesson';
      prompt = `Write Chapter 3 (The Lesson) for a creative, engaging, and age-appropriate children's story in the ${story.style} style. This chapter should be about 700 characters.\n\nThe story is for a ${story.ageGroup} ${story.gender?.toLowerCase() || ''} named ${story.name}. This character is described as \"${story.character}\" and enjoys ${story.hobbies?.join(", ") || ''}.\n\nChapter 3 should provide a resolution with an uplifting moral or lesson. Make it imaginative, vivid, and fun. Avoid mature or scary content. The tone should be heartwarming, educational, and suitable for bedtime or classroom reading.\n\nPlease provide:\n1. A creative title for this chapter (2-4 words)\n2. A brief description (1 sentence, 10-15 words)\n3. The chapter text (about 700 characters)\n\nFormat your response as:\nTITLE: [title]\nDESCRIPTION: [description]\nTEXT: [chapter text]`;
    }
    // Generate chapter text, title, and description
    let chapterText = '';
    let chapterTitle = '';
    let chapterDescription = '';
    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: 'You are a creative children\'s story writer.' },
          { role: 'user', content: prompt },
        ],
        max_tokens: 800,
        temperature: 0.8,
      });
      if (completion.choices && completion.choices[0] && completion.choices[0].message && typeof completion.choices[0].message.content === 'string') {
        const content = completion.choices[0].message.content.trim();
        
        // Parse the response to extract title, description, and text
        const titleMatch = content.match(/TITLE:\s*(.+)/i);
        const descriptionMatch = content.match(/DESCRIPTION:\s*(.+)/i);
        const textMatch = content.match(/TEXT:\s*([\s\S]+)/i);
        
        chapterTitle = titleMatch ? titleMatch[1].trim() : defaultTitle;
        chapterDescription = descriptionMatch ? descriptionMatch[1].trim() : 'A new adventure unfolds';
        chapterText = textMatch ? textMatch[1].trim() : content;
      } else {
        chapterTitle = defaultTitle;
        chapterDescription = 'A new adventure unfolds';
        chapterText = '';
      }
    } catch (err) {
      return res.status(500).json({ error: 'Failed to generate chapter text', details: err });
    }
    // Generate audio for chapter
    let chapterAudioUrl = '';
    try {
      const openaiTTSRes = await axios.post(
        'https://api.openai.com/v1/audio/speech',
        {
          model: 'tts-1',
          input: chapterText,
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
        const stream = cloudinary.uploader.upload(
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
    // Update the chapter in the story
    const update = {
      $set: {
        [`chapters.${chapterNumber}.title`]: chapterTitle,
        [`chapters.${chapterNumber}.description`]: chapterDescription,
        [`chapters.${chapterNumber}.text`]: chapterText,
        [`chapters.${chapterNumber}.audioUrl`]: chapterAudioUrl,
        [`chapters.${chapterNumber}.generated`]: true,
      }
    };
    await stories.updateOne({ _id: new ObjectId(id) }, update);
    // Return the updated chapter
    res.status(200).json({
      chapter: {
        title: chapterTitle,
        description: chapterDescription,
        text: chapterText,
        audioUrl: chapterAudioUrl,
        generated: true,
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate chapter', details: err });
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