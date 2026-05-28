import express from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import {
  createAdvertisement,
  createAdvertisementDetail,
  createRepository,
  deleteAdvertisement,
  deleteAdvertisementDetail,
  deleteRepository,
  getActiveAdvertisementFeed,
  getAdvertisementById,
  listAdvertisements,
  listRepositories,
  updateAdvertisement,
  updateAdvertisementDetail,
  updateRepository,
} from '../../controllers/marketing/advertisementController.js';
import { admin, protectPOS } from '../../middleware/posAuthMiddleware.js';

const router = express.Router();

const mediaStorage = multer.diskStorage({
  destination(req, file, cb) {
    const uploadPath = path.join(process.cwd(), 'uploads', 'advertisements');
    fs.mkdirSync(uploadPath, { recursive: true });
    cb(null, uploadPath);
  },
  filename(req, file, cb) {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '-');
    cb(null, `advertisement-${Date.now()}-${safeName}`);
  },
});

const mediaUpload = multer({
  storage: mediaStorage,
  limits: {
    fileSize: Number(process.env.ADVERTISEMENT_MEDIA_MAX_BYTES || 250 * 1024 * 1024),
  },
  fileFilter(req, file, cb) {
    if (/^(image|video)\//.test(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Images and videos only'), false);
    }
  },
});

router.get('/active-feed', getActiveAdvertisementFeed);

router.use(protectPOS);
router.use(admin);

router.post('/media', mediaUpload.single('media'), (req, res) => {
  res.status(201).json({
    message: 'Media uploaded successfully',
    media_path: `/uploads/advertisements/${req.file.filename}`,
    media_type: req.file.mimetype.startsWith('video') ? 'video' : 'image',
    original_name: req.file.originalname,
  });
});

router.route('/repositories')
  .get(listRepositories)
  .post(createRepository);

router.route('/repositories/:id')
  .put(updateRepository)
  .delete(deleteRepository);

router.route('/')
  .get(listAdvertisements)
  .post(createAdvertisement);

router.route('/:id')
  .get(getAdvertisementById)
  .put(updateAdvertisement)
  .delete(deleteAdvertisement);

router.post('/:advertisementId/details', createAdvertisementDetail);
router.route('/:advertisementId/details/:detailId')
  .put(updateAdvertisementDetail)
  .delete(deleteAdvertisementDetail);

export default router;
