import { Router } from 'express';
import { createStory, getUserStories, getStoryById, getPaginatedStories, generateChapter, deleteStory, rateStory } from '../controllers/storyController';
import { getStoriesCollection } from '../db';

const router = Router();

router.post('/', createStory);
router.get('/public-paginated', getPaginatedStories);
router.get('/user/:userId', getUserStories);
router.get('/:id', getStoryById);
router.post('/:id/chapter', generateChapter);
router.post('/:id/rate', rateStory);
router.delete('/:id', deleteStory);

export default router; 