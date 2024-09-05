import express from 'express';
import { getAllPromotions, getPromotionById } from '../controllers/promotionController.js'; // Import the controller functions

const router = express.Router();

// Route to get all promotions
router.get('/', getAllPromotions);

// Route to get a single promotion by ID
router.get('/:id', getPromotionById);

export default router;
