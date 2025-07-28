import { Router } from 'express';
import { submitSupportIssue } from '../controllers/supportController';

const router = Router();

router.post('/', submitSupportIssue);

export default router; 