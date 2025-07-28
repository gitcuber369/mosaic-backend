import type { Request, Response } from 'express';
import { getUsersCollection } from '../db';
import type { User } from '../models/user';
import { ObjectId } from 'mongodb';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

export async function createUser(req: Request, res: Response) {
  try {
    const {
      name,
      email,
      profile,
      gender,
      ageGroup,
      hobbies,
      isPremium,
      subscriptionId,
      dailyStoryCount,
      preferences,
    } = req.body;

    if (!name || !gender || !ageGroup || !email) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const user: User = {
      name,
      email,
      profile: profile || '',
      gender,
      ageGroup,
      hobbies: hobbies || [],
      isPremium: false, // Always false on signup
      subscriptionId: subscriptionId || '',
      tokens: 0, // New users start with 0 tokens
      dailyStoryCount: dailyStoryCount || 0,
      preferences: preferences || [],
      createdAt: new Date(),
      storyCreationCredits: 5,
      storyListenCredits: 30,
    };

    const users = getUsersCollection();
    const result = await users.insertOne(user);
    console.log('User saved to DB:', { ...user, _id: result.insertedId });

    // Generate JWT token for the new user
    const token = jwt.sign(
      { userId: result.insertedId.toString(), email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      success: true,
      user: { ...user, _id: result.insertedId },
      token
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create user', details: err });
  }
}

export async function loginUser(req: Request, res: Response) {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const users = getUsersCollection();
    const user = await users.findOne({ email });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: user._id?.toString(), email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(200).json({
      success: true,
      user,
      token
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to login user', details: err });
  }
}

export async function getUserByEmail(req: Request, res: Response) {
  try {
    const { email } = req.query;
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Email is required' });
    }
    const users = getUsersCollection();
    const user = await users.findOne({ email });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
 
    if (typeof user.storyCreationCredits !== 'number') user.storyCreationCredits = 5;
    if (typeof user.storyListenCredits !== 'number') user.storyListenCredits = 30;
    res.status(200).json(user);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch user', details: err });
  }
}

export async function upgradeUserToPremium(req: Request, res: Response) {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }
    const users = getUsersCollection();
    const result: any = await users.findOneAndUpdate(
      { email },
      { $set: { isPremium: true, tokens: 30 } },
      { returnDocument: 'after' }
    );
    if (!result.value) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.status(200).json({ success: true, user: result.value });
  } catch (err) {
    res.status(500).json({ error: 'Failed to upgrade user', details: err });
  }
}

export async function buyStoryCredits(req: Request, res: Response) {
  try {
    const { email, credits } = req.body;
    if (!email || !credits) {
      return res.status(400).json({ error: 'Email and credits are required' });
    }
    const users = getUsersCollection();
    const result: any = await users.findOneAndUpdate(
      { email },
      { $inc: { storyCreationCredits: credits } },
      { returnDocument: 'after' }
    );
    if (!result.value) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.status(200).json({ success: true, user: result.value });
  } catch (err) {
    res.status(500).json({ error: 'Failed to buy credits', details: err });
  }
}

export async function monthlyResetCredits(req: Request, res: Response) {
  try {
    const users = getUsersCollection();
    const result = await users.updateMany(
      {},
      { $set: { storyCreationCredits: 5, storyListenCredits: 30 } }
    );
    res.status(200).json({ success: true, modifiedCount: result.modifiedCount });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reset credits', details: err });
  }
}

export async function revenuecatWebhook(req: Request, res: Response) {
  try {
    const { event } = req.body;
    if (event.type === 'INITIAL_PURCHASE' || event.type === 'RENEWAL') {
      const { subscriber_attributes } = event;
      const email = subscriber_attributes?.$email?.value;
      if (email) {
        const users = getUsersCollection();
        await users.updateOne(
          { email },
          { $set: { isPremium: true, tokens: 30 } }
        );
      }
    }
    res.status(200).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to process webhook', details: err });
  }
}

export async function deductListenCreditForChapter(req: Request, res: Response) {
  try {
    let userId = req.body.userId;
    const email = req.body.email;
    const storyId = req.body.storyId;
    const chapterIndex = req.body.chapterIndex;
    const users = getUsersCollection();

    // If userId is not provided, try to get it from email
    if (!userId && email) {
      const user = await users.findOne({ email });
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      userId = user._id;
    }

    if (!userId) {
      return res.status(400).json({ error: 'userId or email required' });
    }
    if (!storyId || typeof chapterIndex !== 'number') {
      return res.status(400).json({ error: 'storyId and chapterIndex required' });
    }

    // Fetch user to check listening history
    const user = await users.findOne({ _id: new ObjectId(userId) });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if user has already listened to this chapter
    let listenedChapters = user.listenedChapters || [];
    let storyEntry = listenedChapters.find((entry: any) => entry.storyId?.toString() === storyId);
    let alreadyListened = false;
    
    if (storyEntry) {
      alreadyListened = storyEntry.chapters.includes(chapterIndex);
    }

    if (alreadyListened) {
      // User already listened to this chapter, no credit deduction needed
      return res.status(200).json({ 
        listenedTrue: true, 
        storyListenCredits: user.storyListenCredits,
        message: 'Already listened to this chapter'
      });
    }

    // User hasn't listened to this chapter, deduct credit and update history
    let update: any = {
      $inc: { storyListenCredits: -1 }
    };

    if (storyEntry) {
      // Story exists in history, add this chapter to the list
      update.$set = { 
        'listenedChapters.$.chapters': [...storyEntry.chapters, chapterIndex] 
      };
    } else {
      // New story, create new entry
      update.$push = { 
        listenedChapters: { 
          storyId: new ObjectId(storyId), 
          chapters: [chapterIndex] 
        } 
      };
    }

    // Update user with credit deduction and listening history
    const result = await users.findOneAndUpdate(
      { 
        _id: new ObjectId(userId), 
        storyListenCredits: { $gt: 0 },
        ...(storyEntry ? { 'listenedChapters.storyId': new ObjectId(storyId) } : {})
      },
      update,
      { returnDocument: 'after' }
    );

    if (!result || !(result as any).value) {
      return res.status(403).json({ error: 'No listening credits left' });
    }

    const updatedUser = (result as any).value;
    res.status(200).json({ 
      storyListen: true, 
      storyListenCredits: updatedUser.storyListenCredits,
      message: 'Credit deducted and chapter marked as listened'
    });

  } catch (err) {
    console.error('Error in deductListenCreditForChapter:', err);
    res.status(500).json({ error: 'Failed to deduct credit', details: err });
  }
}

// Get user's listening history
export async function getUserListeningHistory(req: Request, res: Response) {
  try {
    let userId = req.query.userId as string;
    const email = req.query.email as string;
    const users = getUsersCollection();

    // If userId is not provided, try to get it from email
    if (!userId && email) {
      const user = await users.findOne({ email });
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      userId = user._id.toString();
    }

    if (!userId) {
      return res.status(400).json({ error: 'userId or email required' });
    }

    const user = await users.findOne({ _id: new ObjectId(userId) });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.status(200).json({
      listenedChapters: user.listenedChapters || [],
      storyListenCredits: user.storyListenCredits
    });

  } catch (err) {
    console.error('Error in getUserListeningHistory:', err);
    res.status(500).json({ error: 'Failed to get listening history', details: err });
  }
} 