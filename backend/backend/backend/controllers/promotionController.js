import Promotion from '../models/promotionModel.js'; // Import the Promotion model

// Controller function to get all promotions
export const getAllPromotions = async (req, res) => {
  try {
    const promotions = await Promotion.find({}); // Fetch all promotions
    res.json(promotions); // Send promotions as JSON response
  } catch (error) {
    res.status(500).json({ message: 'Server error: Unable to fetch promotions' });
  }
};

// Controller function to get a single promotion by ID
export const getPromotionById = async (req, res) => {
  try {
    const promotion = await Promotion.findById(req.params.id); // Fetch promotion by ID

    if (promotion) {
      res.json(promotion); // Send promotion as JSON response
    } else {
      res.status(404).json({ message: 'Promotion not found' }); // Send 404 if not found
    }
  } catch (error) {
    res.status(500).json({ message: 'Server error: Unable to fetch promotion' });
  }
};
