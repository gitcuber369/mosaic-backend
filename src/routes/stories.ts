import { Router } from 'express';
import { createStory, getUserStories, getStoryById, getPaginatedStories, generateChapter, deleteStory } from '../controllers/storyController';
import { getStoriesCollection } from '../db';

const router = Router();

router.post('/', createStory);
router.get('/user', getUserStories);
router.get('/public-paginated', getPaginatedStories);
router.get('/:id', getStoryById);
router.post('/:id/generate-chapter', generateChapter);
router.delete('/:id', deleteStory);

export default router; 