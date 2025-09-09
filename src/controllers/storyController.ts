// Generate audio for a chapter (given storyId and chapterIndex)
export async function generateChapterAudio(req: Request, res: Response) {
  try {
    const { id, chapterIndex } = req.params;
    const chapterIdx = parseInt(chapterIndex, 10);
    if (!id || isNaN(chapterIdx) || chapterIdx < 0 || chapterIdx > 3) {
      return res.status(400).json({ error: 'Invalid story id or chapter index (must be 0-3)' });
    }
    const stories = getStoriesCollection();
    const story = await stories.findOne({ _id: new ObjectId(id) });
    if (!story) return res.status(404).json({ error: 'Story not found' });
    if (!story.chapters || !story.chapters[chapterIdx] || !story.chapters[chapterIdx].text) {
      return res.status(400).json({ error: 'Chapter text not found in story' });
    }
    const chapterText = story.chapters[chapterIdx].text;
    // Generate audio for chapter
    let chapterAudioUrl = '';
    try {
      const openaiTTSRes = await axios.post(
        'https://api.openai.com/v1/audio/speech',
        {
          model: 'tts-1',
          input: chapterText,
          voice: 'breeze',
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
        [`chapters.${chapterIdx}.audioUrl`]: chapterAudioUrl,
      }
    };
    await stories.updateOne({ _id: new ObjectId(id) }, update);
    // Return the updated audioUrl
    res.status(200).json({
      audioUrl: chapterAudioUrl,
      chapterIndex: chapterIdx,
      storyId: id,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate chapter audio', details: err });
  }
}
import type { Request, Response } from 'express';
import { getStoriesCollection, getUsersCollection } from '../db';
import { ObjectId } from 'mongodb';
import axios from 'axios';
import { v2 as cloudinary } from 'cloudinary';
import OpenAI from 'openai';
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME  as string,
  api_key: process.env.CLOUDINARY_API_KEY as string,
  api_secret: process.env.CLOUDINARY_API_SECRET as string,
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function createStory(req: Request, res: Response) {
  console.log('🚀 Starting story creation process...');
  
  try {
    const { userId, style, voice, rating, name, character, gender, ageGroup, hobbies } = req.body;
    console.log('📝 Request body:', { userId, style, voice, rating, name, character, gender, ageGroup, hobbies });
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

    // Check if user has generation credits (tokens) before proceeding
    console.log('💰 Checking user credits for userId:', userId);
    const users = getUsersCollection();
    const user = await users.findOne({ _id: new ObjectId(userId) });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    // Premium users can generate unlimited stories
    // Update lastStoryRecipient on user with the latest story recipient data
    await users.updateOne(
      { _id: new ObjectId(userId) },
      {
        $set: {
          lastStoryRecipient: {
            name,
            gender,
            ageGroup,
            hobbies: hobbies || [],
          },
        },
      }
    );
    if (!user.isPremium) {
      if (typeof user.tokens !== 'number' || user.tokens <= 0) {
        console.log('❌ No generation credits left for userId:', userId);
        return res.status(403).json({ error: 'No generation credits left' });
      }
      // Deduct 1 generation credit
      await users.updateOne({ _id: new ObjectId(userId) }, { $inc: { tokens: -1 } });
    }
    
    console.log('✅ User has sufficient generation credits, proceeding with story generation');


    // Map age group to number of chapters
    const ageGroupToChapters: Record<string, number> = {
      '0-3': 1,
      '4-6': 2,
      '7-9': 3,
      '10-12': 4,
      '12+': 5,
    };
    const numChapters = ageGroupToChapters[ageGroup] || 3;

    // Single LLM call for intro + all chapters in JSON format
  let storyTitle = '', storyDescription = '', introTitle = '', introDescription = '', introText = '';
  const chapterTitles: string[] = [];
  const chapterDescriptions: string[] = [];
  const chapterTexts: string[] = [];
  const chapterThemes: string[] = [];
    try {
      let prompt = `Write a creative, engaging, and age-appropriate children's story in the ${style} style for a ${ageGroup} ${gender} child. The main character is described as \"${character}\" and enjoys.\n\n`;
      prompt += `Return your response as valid minified JSON (no comments, no trailing commas, no extra text).\n\nThe JSON should have this structure:\n{\n  \"storyTitle\": string,\n  \"storyDescription\": string,\n  \"introduction\": {\n    \"title\": string,\n    \"description\": string,\n    \"text\": string\n  },\n  \"chapters\": [\n    {\n      \"title\": string,\n      \"description\": string,\n      \"text\": string\n    }${numChapters > 1 ? ", ..." : ''}\n  ]\n}\n\nRequirements:\n- The introduction should be about 200-250 words.\n- There should be exactly ${numChapters} chapters.\n- Each chapter must have a unique, creative title (2-4 words), a 1-sentence description (10-15 words), and a chapter text (about 200-250 words).\n- Do not include any explanation or commentary, only the JSON.`;

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are a creative children\'s story writer.' },
          { role: 'user', content: prompt },
        ],
        max_tokens: 8000,
        temperature: 0.8,
      });
      if (completion.choices && completion.choices[0] && completion.choices[0].message && typeof completion.choices[0].message.content === 'string') {
        let content = completion.choices[0].message.content.trim();
        // Try to extract JSON from the response
        let jsonStart = content.indexOf('{');
        let jsonEnd = content.lastIndexOf('}');
        if (jsonStart === -1 || jsonEnd === -1) throw new Error('No JSON found in LLM response');
        let jsonString = content.substring(jsonStart, jsonEnd + 1);
        let storyObj;
        try {
          storyObj = JSON.parse(jsonString);
        } catch (e) {
          console.error('❌ Failed to parse LLM JSON:', e, jsonString);
          return res.status(500).json({ error: 'Failed to parse story JSON from LLM response', details: e });
        }
        storyTitle = storyObj.storyTitle || '';
        storyDescription = storyObj.storyDescription || '';
        if (storyObj.introduction) {
          introTitle = storyObj.introduction.title || '';
          introDescription = storyObj.introduction.description || '';
          introText = storyObj.introduction.text || '';
        }
        if (Array.isArray(storyObj.chapters)) {
          for (let i = 0; i < numChapters; i++) {
            const ch = storyObj.chapters[i] || {};
            chapterTitles.push(ch.title || `Chapter ${i+1}`);
            chapterDescriptions.push(ch.description || 'No description available.');
            chapterThemes.push(ch.theme || 'Adventure');
            chapterTexts.push(ch.text || 'Chapter unavailable.');
          }
        }
      } else {
        introTitle = 'Introduction';
        introDescription = 'Meet our main character';
        introText = '';
        for (let i = 0; i < numChapters; i++) {
          chapterTitles.push(`Chapter ${i+1}`);
          chapterDescriptions.push('No description available.');
          chapterTexts.push('Chapter unavailable.');
        }
      }
    } catch (err) {
      console.error('❌ Error generating story:', err);
      return res.status(500).json({ error: 'Failed to generate story', details: err });
    }

    // 3. Generate image with DALL-E (OpenAI)
    console.log('🎨 Starting image generation with gpt-image-1...');
    let imageUrl = '';
    try {
      // Use the first chapter's theme, or join all themes for a richer prompt
      const storyTheme = chapterThemes.length > 0 ? chapterThemes[0] : 'magical adventure';
      const imagePrompt = `A highly detailed 3D illustration in a whimsical, magical cartoon style. Theme: ${storyTheme}. The scene features ${character} in a vibrant, storybook-like environment filled with variety and depth. The background includes a single distant fairytale tower peeking through soft clouds for a hint of fantasy, but focus on rolling green hills, a shimmering river, a whimsical wooden bridge, giant mushrooms with glowing caps, colorful wildflowers, and a few floating lanterns drifting in the air. Add unique trees with curly branches, sparkling fireflies, and a glowing path of stepping stones leading into the scene. Use cinematic lighting with warm tones, glowing highlights, soft shadows, and painterly textures. The mood is dreamlike and full of childlike wonder, with subtle magic particles in the air. Maintain stylized 3D proportions, soft sculpting, and a fairytale-like composition throughout, ensuring the background feels rich and diverse without repetitive elements.`;
      const imageRes = await openai.images.generate({
        prompt: imagePrompt,
        n: 1,
        model : 'dall-e-3',
        size: '1024x1024',
        quality: 'hd',
        response_format: 'url',
      });
      console.log('📸 Image generation response:', imageRes);
      if (imageRes && Array.isArray(imageRes.data) && imageRes.data[0] && typeof imageRes.data[0].url === 'string') {
        console.log('✅ Image generated successfully, downloading...');
        const imageBufferRes = await axios.get(imageRes.data[0].url, { responseType: 'arraybuffer' });
        const imageBuffer = Buffer.from(imageBufferRes.data);
        console.log('📥 Image downloaded, uploading to Cloudinary...');
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
        console.log('✅ Image uploaded to Cloudinary:', imageUrl);
      } else {
        console.log('⚠️ No image data in response, using empty image URL');
        imageUrl = '';
      }
    } catch (err) {
      console.error('❌ Error generating or uploading image:', err);
      return res.status(500).json({ error: 'Failed to generate or upload image', details: err });
    }


    // 4. Generate audio for Introduction
    // (Removed: No audio generation for introduction)

    // 5. Generate audio for all chapters
    console.log('🎵 Generating audio for all chapters...');
    const chapterAudioUrls: string[] = [];
    for (let i = 0; i < numChapters; i++) {
      try {
        const openaiTTSRes = await axios.post(
          'https://api.openai.com/v1/audio/speech',
          {
            model: 'tts-1',
            input: chapterTexts[i],
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
        const audioUrl = await new Promise((resolve, reject) => {
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
        chapterAudioUrls.push(audioUrl as string);
        console.log(`✅ Chapter ${i + 1} audio uploaded to Cloudinary:`, audioUrl);
      } catch (err) {
        console.error(`❌ Error generating or uploading chapter ${i + 1} audio:`, err);
        return res.status(500).json({ error: `Failed to generate or upload chapter ${i + 1} audio`, details: err });
      }
    }

    // 6. Save story with chapters array (all audio included)
    console.log('💾 Starting story save to database...');
    const stories = getStoriesCollection();
    const chapters = [
      {
        title: introTitle,
        description: introDescription,
        text: introText,
        audioUrl: '',
        generated: true,
      },
      ...Array.from({ length: numChapters }, (_, i) => ({
        title: chapterTitles[i],
        description: chapterDescriptions[i],
        text: chapterTexts[i],
        audioUrl: chapterAudioUrls[i],
        generated: true,
      })),
    ];
    const result = await stories.insertOne({
      userId: new ObjectId(userId),
      style,
      voice: voiceId,
      image: imageUrl,
      rating: typeof rating === 'number' ? rating : 0.0,
      createdAt: new Date(),
      chapters,
      ageGroup,
      gender,
      name,
      character,
      hobbies,
    });
    console.log('✅ Story saved to database successfully with ID:', result.insertedId);

    // 7. Deduct credits only after successful story creation
    console.log('💰 Deducting credits after successful story creation...');
    const updateResult = await users.updateOne(
      { _id: new ObjectId(userId), storyListenCredits: { $gt: 0 } },
      { $inc: { storyListenCredits: -1 } }
    );

    if (updateResult.modifiedCount === 0) {
      console.log('❌ Failed to deduct credits for userId:', userId);
      // Even if credit deduction fails, the story was created successfully
      // We'll still return success but log the issue
      console.log('⚠️ Story created but credit deduction failed');
    } else {
      console.log('✅ Credits deducted successfully for userId:', userId);
    }

    console.log('🎉 Story creation completed successfully!');
    res.status(201).json({
      success: true,
      storyId: result.insertedId,
      chapters: chapters.map((c, i) => i < 2 ? c : { title: c.title, generated: false }),
      image: imageUrl,
    });
  } catch (err) {
    console.error('❌ Fatal error in story creation:', err);
    // If any step fails, we don't deduct credits since the story wasn't created successfully
    console.log('⚠️ Story creation failed, no credits deducted');
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
    if (!id) {
      return res.status(400).json({ error: 'Story ID is required' });
    }

    console.log('🔍 Looking for story with id:', id);
    const stories = getStoriesCollection();
    const story = await stories.findOne({ _id: new ObjectId(id) });
    if (!story) {
      return res.status(404).json({ error: 'Story not found' });
    }

    // Fetch user to check premium status
    const users = getUsersCollection();
    // Strictly validate `userIdString` as a string
    const userIdString = typeof userId === 'string' ? userId : undefined;
    if (userIdString && ObjectId.isValid(userIdString)) {
      const user = await users.findOne({ _id: new ObjectId(userIdString) });
      if (user?.isPremium) {
        console.log('✅ Premium user detected, skipping credit deduction');
        return res.status(200).json(story);
      }
    }

    // Only deduct credits if this is a public story access (not for chapter pages)
    // For chapter pages, we handle credit deduction separately
    if (userId && story.userId && story.userId.toString() !== String(userId) && !req.query.skipCreditDeduction) {
      // Deduct credits logic here
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
      prompt = `Write Chapter 2 (The Journey) for a creative, engaging, and age-appropriate children's story in the ${story.style} style. This chapter should be about 1000 characters.\n\nThe story is for a ${story.ageGroup} ${story.gender?.toLowerCase() || ''} named ${story.name}. This character is described as \"${story.character}\" and enjoys ${story.hobbies?.join(", ") || ''}.\n\nChapter 2 should describe how the character faces the challenge. Make it imaginative, vivid, and fun. Avoid mature or scary content. The tone should be heartwarming, educational, and suitable for bedtime or classroom reading.\n\nPlease provide:\n1. A creative title for this chapter (2-4 words)\n2. A brief description (1 sentence, 10-15 words)\n3. The chapter text (about 1000 characters)\n\nFormat your response as:\nTITLE: [title]\nDESCRIPTION: [description]\nTEXT: [chapter text]`;
    } else if (chapterNumber === 3) {
      defaultTitle = 'The Lesson';
      prompt = `Write Chapter 3 (The Lesson) for a creative, engaging, and age-appropriate children's story in the ${story.style} style. This chapter should be about 1000 characters.\n\nThe story is for a ${story.ageGroup} ${story.gender?.toLowerCase() || ''} named ${story.name}. This character is described as \"${story.character}\" and enjoys ${story.hobbies?.join(", ") || ''}.\n\nChapter 3 should provide a resolution with an uplifting moral or lesson. Make it imaginative, vivid, and fun. Avoid mature or scary content. The tone should be heartwarming, educational, and suitable for bedtime or classroom reading.\n\nPlease provide:\n1. A creative title for this chapter (2-4 words)\n2. A brief description (1 sentence, 10-15 words)\n3. The chapter text (about 1000 characters)\n\nFormat your response as:\nTITLE: [title]\nDESCRIPTION: [description]\nTEXT: [chapter text]`;
    }
    // Generate chapter text, title, and description
    let chapterText = '';
    let chapterTitle = '';
    let chapterDescription = '';
    try {
      const completion = await openai.chat.completions.create({
        model: 'chatgpt-4o-latest',
        messages: [
          { role: 'system', content: 'You are a creative children\'s story writer.' },
          { role: 'user', content: prompt },
        ],
        max_tokens: 8000,
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

// POST /api/stories/:id/rate
export async function yesrateStory(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { rating } = req.body as { rating: number };
    if (!id) return res.status(400).json({ error: 'Missing story id' });
    const numeric = Number(rating);
    if (!Number.isFinite(numeric) || numeric < 1 || numeric > 5) {
      return res.status(400).json({ error: 'Rating must be a number between 1 and 5' });
    }
    const stories = getStoriesCollection();
    const story = await stories.findOne({ _id: new ObjectId(id) });
    if (!story) return res.status(404).json({ error: 'Story not found' });

    const currentCount = story.ratingCount || 0;
    const currentAvg = typeof story.rating === 'number' ? story.rating : 0;
    const newCount = currentCount + 1;
    const newAvg = currentCount === 0 ? numeric : (currentAvg * currentCount + numeric) / newCount;

    await stories.updateOne(
      { _id: new ObjectId(id) },
      { $set: { rating: Number(newAvg.toFixed(2)), ratingCount: newCount } }
    );

    res.status(200).json({ success: true, rating: Number(newAvg.toFixed(2)), ratingCount: newCount });
  } catch (err) {
    res.status(500).json({ error: 'Failed to rate story', details: err });
  }
}