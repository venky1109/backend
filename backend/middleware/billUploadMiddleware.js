import path from 'path';
import multer from 'multer';

const allowedMimeTypes = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const allowedExtensions = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.webp']);

const fileFilter = (req, file, cb) => {
  const extension = path.extname(file.originalname).toLowerCase();

  if (allowedMimeTypes.has(file.mimetype) && allowedExtensions.has(extension)) {
    return cb(null, true);
  }

  return cb(new Error('Only PDF, JPG, PNG, and WEBP bill files are allowed'));
};

export const uploadBillFile = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: Number(process.env.BILL_UPLOAD_MAX_BYTES || 10 * 1024 * 1024),
  },
  fileFilter,
}).fields([
  { name: 'file', maxCount: 1 },
  { name: 'bill', maxCount: 1 },
  { name: 'attachment', maxCount: 1 },
  { name: 'image', maxCount: 1 },
]);
