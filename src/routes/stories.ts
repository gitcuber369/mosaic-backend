
import { Router } from 'express';
import { createStory, getUserStories, getStoryById, getPaginatedStories, generateChapter, deleteStory, rateStory, generateChapterAudio } from '../controllers/storyController';
import { getStoriesCollection } from '../db';

const router = Router();

/**
 * @swagger
 * /api/stories:
 *   post:
 *     summary: Create a new story
 *     tags:
 *       - Stories
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               userId:
 *                 type: string
 *                 description: ID of the user creating the story
 *               style:
 *                 type: string
 *                 description: Style of the story
 *               voice:
 *                 type: string
 *                 description: Voice preference for the story
 *               rating:
 *                 type: number
 *                 description: Initial rating of the story
 *               name:
 *                 type: string
 *                 description: Name of the main character
 *               character:
 *                 type: string
 *                 description: Description of the main character
 *               gender:
 *                 type: string
 *                 description: Gender of the main character
 *               ageGroup:
 *                 type: string
 *                 description: Age group of the main character
 *               hobbies:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Hobbies of the main character
 *     responses:
 *       201:
 *         description: Story created successfully
 *       400:
 *         description: Missing required fields
 *       403:
 *         description: No story credits left
 *       404:
 *         description: User not found
 *       500:
 *         description: Failed to create story
 */

/**
 * @swagger
 * /api/stories/public-paginated:
 *   get:
 *     summary: Get paginated public stories
 *     tags:
 *       - Stories
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         description: Page number for pagination
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Number of stories per page
 *     responses:
 *       200:
 *         description: Paginated public stories retrieved successfully
 *       500:
 *         description: Failed to fetch paginated public stories
 */

/**
 * @swagger
 * /api/stories/user/{userId}:
 *   get:
 *     summary: Get stories of a specific user
 *     tags:
 *       - Stories
 *     parameters:
 *       - in: path
 *         name: userId
 *         schema:
 *           type: string
 *         required: true
 *         description: ID of the user
 *     responses:
 *       200:
 *         description: User stories retrieved successfully
 *       500:
 *         description: Failed to fetch user stories
 */

/**
 * @swagger
 * /api/stories/{id}:
 *   get:
 *     summary: Get a story by its ID
 *     tags:
 *       - Stories
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: ID of the story
 *     responses:
 *       200:
 *         description: Story retrieved successfully
 *       500:
 *         description: Failed to fetch story
 */

/**
 * @swagger
 * /api/stories/{id}/chapter:
 *   post:
 *     summary: Generate a chapter for a story
 *     tags:
 *       - Stories
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: ID of the story
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               chapterNumber:
 *                 type: integer
 *                 description: Chapter number to generate (2 or 3)
 *     responses:
 *       200:
 *         description: Chapter generated successfully
 *       500:
 *         description: Failed to generate chapter
 */

/**
 * @swagger
 * /api/stories/{id}/rate:
 *   post:
 *     summary: Rate a story
 *     tags:
 *       - Stories
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: ID of the story
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               rating:
 *                 type: number
 *                 description: Rating value (1 to 5)
 *     responses:
 *       200:
 *         description: Story rated successfully
 *       500:
 *         description: Failed to rate story
 */

/**
 * @swagger
 * /api/stories/{id}:
 *   delete:
 *     summary: Delete a story by its ID
 *     tags:
 *       - Stories
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: ID of the story
 *     responses:
 *       200:
 *         description: Story deleted successfully
 *       500:
 *         description: Failed to delete story
 */

router.post('/', createStory);
router.post('/:id/generate-audio/:chapterIndex', generateChapterAudio);
router.get('/public-paginated', getPaginatedStories);
router.get('/user/:userId', getUserStories);
router.get('/:id', getStoryById);
router.post('/:id/chapter', generateChapter);
router.post('/:id/rate', rateStory);
router.delete('/:id', deleteStory);

export default router;