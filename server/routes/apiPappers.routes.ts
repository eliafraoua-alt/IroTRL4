import { Router } from 'express';
import { 
  searchPappers, 
  handlePappersProxy, 
  handleINPIProxy, 
  handleBodaccProxy 
} from '../controllers/pappers.controller';
import { apiKeyAuth } from '../middleware/apiKeyAuth';

const router = Router();

// Mounted under /api/pappers
// Toutes les routes protégées par apiKeyAuth (actif si INTERNAL_API_KEY défini)
router.post('/search',        apiKeyAuth, searchPappers);
router.get('/',               apiKeyAuth, handlePappersProxy);
router.get('/inpi/search',    apiKeyAuth, handleINPIProxy);
router.get('/bodacc/search',  apiKeyAuth, handleBodaccProxy);

export default router;
