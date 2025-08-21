import { ObjectId } from 'mongodb';

export interface User {
  _id?: ObjectId;
  name: string;
  email: string;
  profile: string;
  gender: string;
  ageGroup: string;
  hobbies: string[];
  isPremium: boolean;
  subscriptionId: string;
  tokens: number;
  dailyStoryCount: number;
  preferences: string[];
  createdAt: Date;
  storyCreationCredits?: number; // Deprecated - now using storyListenCredits for both generation and listening
  storyListenCredits: number;
  listenedChapters?: Array<{ storyId: ObjectId; chapters: number[]; lastPlayedAt?: Date }>;
  // Stripe-related fields
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  premiumExpiresAt?: Date;
} 