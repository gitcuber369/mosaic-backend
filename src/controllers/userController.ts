import type { Request, Response } from 'express';
import { getUsersCollection } from '../db';
import { getStoriesCollection } from '../db';
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
      tokens: 5, // New users start with 5 generation credits
      dailyStoryCount: dailyStoryCount || 0,
      preferences: preferences || [],
      createdAt: new Date(),
      storyListenCredits: 30, // 30 listening credits
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
      { $inc: { storyListenCredits: credits } },
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
      { $set: { storyListenCredits: 30 } }
    );
    res.status(200).json({ success: true, modifiedCount: result.modifiedCount });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reset credits', details: err });
  }
}

// RevenueCat webhook removed - replaced with Stripe webhook

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

    // Ensure userId is always an ObjectId
    if (typeof userId === 'string') {
      userId = new ObjectId(userId);
    }

    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    if (!storyId || typeof chapterIndex !== 'number') {
      return res.status(400).json({ error: 'Story ID and chapter index are required' });
    }

    // Fetch user to check listening history
    const user = await users.findOne({ _id: userId });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if the user is premium
    if (user.isPremium) {
      // Premium users should still have their listened history recorded,
      // but no credits should be deducted.
      console.log('✅ Premium user detected, record listened chapter without deducting credits');

      let listenedChapters = user.listenedChapters || [];
      let storyEntry = listenedChapters.find((entry: any) => entry.storyId?.toString() === storyId);

      if (storyEntry) {
        // If chapter already recorded, return OK. Otherwise add chapter and update lastPlayedAt.
        if (storyEntry.chapters.includes(chapterIndex)) {
          return res.status(200).json({
            storyListen: true,
            storyListenCredits: user.storyListenCredits,
            message: 'Chapter already listened',
          });
        }

        const result = await users.findOneAndUpdate(
          { _id: userId, 'listenedChapters.storyId': new ObjectId(storyId) },
          { $addToSet: { 'listenedChapters.$.chapters': chapterIndex }, $set: { 'listenedChapters.$.lastPlayedAt': new Date() } },
          { returnDocument: 'after' }
        );

        const updatedUser = (result as any).value || user;
        return res.status(200).json({
          storyListen: true,
          storyListenCredits: updatedUser.storyListenCredits,
          message: 'Premium user, listened chapter recorded',
        });
      } else {
        const result = await users.findOneAndUpdate(
          { _id: userId },
          { $push: { listenedChapters: { storyId: new ObjectId(storyId), chapters: [chapterIndex], lastPlayedAt: new Date() } } },
          { returnDocument: 'after' }
        );

        const updatedUser = (result as any).value || user;
        return res.status(200).json({
          storyListen: true,
          storyListenCredits: updatedUser.storyListenCredits,
          message: 'Premium user, listened chapter recorded',
        });
      }
    }

    // Debug logs
    console.log('User:', user);
    console.log('User credits:', user.storyListenCredits);

    // Check if user has already listened to this chapter
    let listenedChapters = user.listenedChapters || [];
    let storyEntry = listenedChapters.find((entry: any) => entry.storyId?.toString() === storyId);
    let alreadyListened = false;
    if (storyEntry) {
      alreadyListened = storyEntry.chapters.includes(chapterIndex);
    }

    if (alreadyListened) {
      return res.status(200).json({
        storyListen: true,
        storyListenCredits: user.storyListenCredits,
        message: 'Chapter already listened',
      });
    }

    let update: any = {};
    let updateQuery: any = { _id: userId };
    // If this is the first time listening to any chapter of this story, deduct credit
    if (!storyEntry) {
      update.$inc = { storyListenCredits: -1 };
      update.$push = {
        listenedChapters: {
          storyId: new ObjectId(storyId),
          chapters: [chapterIndex],
          lastPlayedAt: new Date(),
        },
      };
      updateQuery.storyListenCredits = { $gt: 0 };
    } else {
      // Only update chapters and lastPlayedAt, do not deduct credit
      update.$addToSet = { 'listenedChapters.$.chapters': chapterIndex };
      update.$set = { 'listenedChapters.$.lastPlayedAt': new Date() };
      updateQuery['listenedChapters.storyId'] = new ObjectId(storyId);
    }
    console.log('Update query:', updateQuery);

    // Update user with or without credit deduction
    const result = await users.findOneAndUpdate(updateQuery, update, { returnDocument: 'after' });

    if (!result || !(result as any).value) {
      return res.status(403).json({ error: 'No listening credits left' });
    }

    const updatedUser = (result as any).value;
    res.status(200).json({
      storyListen: true,
      storyListenCredits: updatedUser.storyListenCredits,
      message: storyEntry ? 'Chapter marked as listened (no credit deducted)' : 'Credit deducted and story marked as listened',
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
    // Build a list of unique story IDs the user has listened to
    const listenedChapters = user.listenedChapters || [];
    const storyIdStrings = Array.from(new Set(listenedChapters.map((e: any) => e.storyId?.toString()).filter(Boolean)));

    let listenedStories: any[] = [];
    if (storyIdStrings.length > 0) {
      const storiesCollection = getStoriesCollection();
      const objIds = storyIdStrings.map((id) => new ObjectId(id));
      const stories = await storiesCollection.find({ _id: { $in: objIds } }).toArray();
      // Attach listenedEntry (with lastPlayedAt) to each story
      listenedStories = stories.map((s: any) => {
        const listenedEntry = listenedChapters.find((e: any) => e.storyId?.toString() === s._id.toString());
        return { ...s, _id: s._id.toString(), listenedEntry };
      });
      // Sort by lastPlayedAt descending (most recent first)
      listenedStories.sort((a, b) => {
        const aTime = a.listenedEntry?.lastPlayedAt ? new Date(a.listenedEntry.lastPlayedAt).getTime() : 0;
        const bTime = b.listenedEntry?.lastPlayedAt ? new Date(b.listenedEntry.lastPlayedAt).getTime() : 0;
        return bTime - aTime;
      });
    }

    res.status(200).json({
      listenedStories,
      storyListenCredits: user.storyListenCredits,
    });

  } catch (err) {
    console.error('Error in getUserListeningHistory:', err);
    res.status(500).json({ error: 'Failed to get listening history', details: err });
  }
} 

// Delete user account by email
export async function deleteUserAccount(req: Request, res: Response) {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });
    const users = getUsersCollection();
    const result = await users.deleteOne({ email });
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.status(200).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete user', details: err });
  }
}