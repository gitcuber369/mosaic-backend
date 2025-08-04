import { ObjectId } from 'mongodb';

export interface Story {
  _id?: ObjectId;
  userId: ObjectId;
  // Deprecated: use chapters instead
  text?: string;
  style: string;
  voice: string;
  image: string; // URL or path to the image
  // Deprecated: use chapters instead
  audioUrl?: string; // URL to the generated audio file (mp3)
  rating: number; // User rating for the story
  createdAt: Date;
  chapters: Array<{
    title: string;
    description?: string;
    text: string;
    audioUrl?: string;
    generated: boolean;
    audioGenerated?: boolean;
  }>;
  ageGroup: string;
  gender: string;
  name: string;
  character: string;
  hobbies: string[];
} 