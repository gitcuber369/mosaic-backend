import { Router } from 'express';
import { createUser, getUserByEmail, loginUser, deleteUserAccount } from '../controllers/userController';
import { upgradeUserToPremium, buyStoryCredits, monthlyResetCredits, deductListenCreditForChapter, getUserListeningHistory } from '../controllers/userController';

const router = Router();

// POST /api/users
router.post('/', createUser);

// GET /api/users/by-email?email=...
router.get('/by-email', getUserByEmail);

// POST /api/users/login
router.post('/login', loginUser);

// POST /api/users/upgrade
router.post('/upgrade', upgradeUserToPremium);

// POST /api/users/buy-credits
router.post('/buy-credits', buyStoryCredits);

// POST /api/users/monthly-reset
router.post('/monthly-reset', monthlyResetCredits);

// POST /api/users/delete-account
router.post('/delete-account', deleteUserAccount);

// RevenueCat webhook removed - replaced with Stripe webhook

// POST /api/users/deduct-listen-credit-chapter
router.post('/deduct-listen-credit-chapter', deductListenCreditForChapter);

// GET /api/users/listening-history
router.get('/listening-history', getUserListeningHistory);

export default router; 