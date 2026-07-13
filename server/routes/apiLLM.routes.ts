import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { getLLMStatus, callLLM, extractPdf, generateWord } from '../controllers/llm.controller';
import { apiKeyAuth } from '../middleware/apiKeyAuth';

const router = Router();

const llmLimiter = rateLimit({
  windowMs: 60_000, 
  max: 120,
  message: { error: 'Trop de requêtes LLM — réessayez dans 1 minute.' },
  standardHeaders: true, 
  legacyHeaders: false,
  skip: req => req.ip === '127.0.0.1',
});

// Under /api/llm
router.get('/', getLLMStatus);
router.post('/', apiKeyAuth, llmLimiter, callLLM);
router.post('/extract-pdf', apiKeyAuth, llmLimiter, extractPdf);
router.post('/generate-word', apiKeyAuth, llmLimiter, generateWord);

export default router;
