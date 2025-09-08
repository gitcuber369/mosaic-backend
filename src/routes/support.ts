import { Router } from 'express';
import { submitSupportIssue } from '../controllers/supportController';
import { authenticateToken } from '../middleware/auth';

/**
 * @swagger
 * /api/support:
 *   post:
 *     summary: Submit a support issue
 *     tags:
 *       - Support
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               type:
 *                 type: string
 *                 description: The type of the support issue
 *               description:
 *                 type: string
 *                 description: Detailed description of the issue
 *               email:
 *                 type: string
 *                 description: Email of the user submitting the issue
 *     responses:
 *       201:
 *         description: Support issue submitted successfully
 *       400:
 *         description: Type, description, and email are required
 *       500:
 *         description: Failed to submit support issue
 */

const router = Router();

// Support route (protected)
router.post('/', authenticateToken, submitSupportIssue);

export default router;