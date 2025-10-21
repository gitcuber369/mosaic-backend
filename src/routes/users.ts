import { Router } from "express";
import {
  buyStoryCredits,
  createUser,
  deductListenCreditForChapter,
  deleteUserAccount,
  getUserByEmail,
  getUserListeningHistory,
  loginUser,
  monthlyResetCredits,
  upgradeUserToPremium,
  saveRevenuecatAppUserId,
} from "../controllers/userController";
import { authenticateToken } from "../middleware/auth";

const router = Router();

/**
 * @swagger
 * /api/users:
 *   post:
 *     summary: Create a new user
 *     tags:
 *       - Users
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               email:
 *                 type: string
 *               gender:
 *                 type: string
 *               ageGroup:
 *                 type: string
 *               profile:
 *                 type: string
 *               hobbies:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       201:
 *         description: User created successfully
 *       400:
 *         description: Missing required fields
 *       500:
 *         description: Failed to create user
 */
// POST /api/users (signup, public)
router.post("/", createUser);

/**
 * @swagger
 * /api/users/by-email:
 *   get:
 *     summary: Get user by email
 *     tags:
 *       - Users
 *     parameters:
 *       - in: query
 *         name: email
 *         schema:
 *           type: string
 *         required: true
 *         description: Email of the user
 *     responses:
 *       200:
 *         description: User retrieved successfully
 *       400:
 *         description: Email is required
 *       404:
 *         description: User not found
 *       500:
 *         description: Failed to fetch user
 */
// GET /api/users/by-email?email=... (protected)
router.get("/by-email", getUserByEmail);

/**
 * @swagger
 * /api/users/login:
 *   post:
 *     summary: Login a user
 *     tags:
 *       - Users
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *     responses:
 *       200:
 *         description: Login successful
 *       400:
 *         description: Email is required
 *       404:
 *         description: User not found
 *       500:
 *         description: Failed to login user
 */
// POST /api/users/login (public)
router.post("/login", loginUser);

/**
 * @swagger
 * /api/users/upgrade:
 *   post:
 *     summary: Upgrade user to premium
 *     tags:
 *       - Users
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *     responses:
 *       200:
 *         description: User upgraded to premium
 *       400:
 *         description: Email is required
 *       404:
 *         description: User not found
 *       500:
 *         description: Failed to upgrade user
 */
// POST /api/users/upgrade (protected)
router.post("/upgrade", authenticateToken, upgradeUserToPremium);

/**
 * @swagger
 * /api/users/buy-credits:
 *   post:
 *     summary: Buy story credits
 *     tags:
 *       - Users
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *               credits:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Credits purchased successfully
 *       400:
 *         description: Email and credits are required
 *       404:
 *         description: User not found
 *       500:
 *         description: Failed to buy credits
 */
// POST /api/users/buy-credits (protected)
router.post("/buy-credits", authenticateToken, buyStoryCredits);

/**
 * @swagger
 * /api/users/monthly-reset:
 *   post:
 *     summary: Reset user credits monthly
 *     tags:
 *       - Users
 *     responses:
 *       200:
 *         description: Credits reset successfully
 *       500:
 *         description: Failed to reset credits
 */
// POST /api/users/monthly-reset (protected)
router.post("/monthly-reset", authenticateToken, monthlyResetCredits);

/**
 * @swagger
 * /api/users/delete-account:
 *   post:
 *     summary: Delete user account
 *     tags:
 *       - Users
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *     responses:
 *       200:
 *         description: Account deleted successfully
 *       400:
 *         description: Email is required
 *       404:
 *         description: User not found
 *       500:
 *         description: Failed to delete user
 */
// POST /api/users/delete-account (protected)
router.post("/delete-account", authenticateToken, deleteUserAccount);

// Public endpoint: save RevenueCat appUserId and optional name/attributes for webhook mapping
router.post("/revenuecat-app-user-id", saveRevenuecatAppUserId);

/**
 * @swagger
 * /api/users/deduct-listen-credit-chapter:
 *   post:
 *     summary: Deduct listen credit for a chapter
 *     tags:
 *       - Users
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               userId:
 *                 type: string
 *               email:
 *                 type: string
 *               storyId:
 *                 type: string
 *               chapterIndex:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Credit deducted successfully or skipped for premium users
 *       400:
 *         description: userId or email, storyId, and chapterIndex are required
 *       403:
 *         description: No listening credits left
 *       404:
 *         description: User not found
 *       500:
 *         description: Failed to deduct credit
 */
// POST /api/users/deduct-listen-credit-chapter (protected)
router.post(
  "/deduct-listen-credit-chapter",
  authenticateToken,
  deductListenCreditForChapter
);

/**
 * @swagger
 * /api/users/listening-history:
 *   get:
 *     summary: Get user listening history
 *     tags:
 *       - Users
 *     parameters:
 *       - in: query
 *         name: userId
 *         schema:
 *           type: string
 *         required: false
 *         description: ID of the user
 *       - in: query
 *         name: email
 *         schema:
 *           type: string
 *         required: false
 *         description: Email of the user
 *     responses:
 *       200:
 *         description: Listening history retrieved successfully
 *       400:
 *         description: userId or email is required
 *       404:
 *         description: User not found
 *       500:
 *         description: Failed to get listening history
 */
// GET /api/users/listening-history (protected)
router.get("/listening-history", authenticateToken, getUserListeningHistory);

export default router;
