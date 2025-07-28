import { ObjectId } from 'mongodb';

export interface SupportIssue {
  _id?: ObjectId;
  type: string;
  description: string;
  createdAt: Date;
} 