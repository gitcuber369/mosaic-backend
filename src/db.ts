import { MongoClient } from 'mongodb';
import type { User } from './models/user';
import type { Story } from './models/story';

const uri = 'mongodb+srv://arpitchaudhary2003:FkynhabsB0KpEJkf@cluster0.n5sh4.mongodb.net/mosaic';
let client: MongoClient;

export async function connectToDatabase() {
  if (!client) {
    client = new MongoClient(uri);
    await client.connect();
    console.log('Connected to MongoDB');
  }
  return client;
}

export function getDb(dbName = 'mosaic') {
  if (!client) {
    throw new Error('MongoClient not initialized. Call connectToDatabase first.');
  }
  return client.db(dbName);
}

export function getUsersCollection() {
  return getDb().collection<User>('users');
}

export function getStoriesCollection() {
  return getDb().collection<Story>('stories');
}

export function getSupportIssuesCollection() {
  return getDb().collection('supportIssues');
} 