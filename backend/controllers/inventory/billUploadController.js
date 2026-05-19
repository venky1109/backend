import path from 'path';
import crypto from 'crypto';
import asyncHandler from '../../middleware/asyncHandler.js';
import { getFirebaseBucket } from '../../config/firebaseAdmin.js';

const getUploadedFile = (files = {}) => {
  const fields = ['file', 'bill', 'attachment', 'image'];

  for (const field of fields) {
    if (files[field]?.[0]) {
      return files[field][0];
    }
  }

  return null;
};

const sanitizeFilename = (filename) =>
  path
    .basename(filename, path.extname(filename))
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();

const buildFirebaseDownloadUrl = (bucketName, filePath, token) =>
  `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(
    filePath
  )}?alt=media&token=${token}`;

export const uploadBill = asyncHandler(async (req, res) => {
  const file = getUploadedFile(req.files);

  if (!file) {
    res.status(400);
    throw new Error('Bill file is required');
  }

  const bucket = await getFirebaseBucket();
  const originalExtension = path.extname(file.originalname).toLowerCase();
  const safeBaseName = sanitizeFilename(file.originalname) || 'bill';
  const storedName = `${Date.now()}-${crypto.randomUUID()}-${safeBaseName}${originalExtension}`;
  const storagePath = `bills/${storedName}`;
  const downloadToken = crypto.randomUUID();
  const firebaseFile = bucket.file(storagePath);

  await firebaseFile.save(file.buffer, {
    contentType: file.mimetype,
    resumable: false,
    metadata: {
      contentDisposition: `inline; filename="${file.originalname.replace(/"/g, '')}"`,
      metadata: {
        firebaseStorageDownloadTokens: downloadToken,
        originalName: file.originalname,
        uploadedBy: req.user?._id?.toString?.() || '',
      },
    },
  });

  const url = buildFirebaseDownloadUrl(bucket.name, storagePath, downloadToken);

  res.status(201).json({
    message: 'Bill uploaded successfully',
    file: {
      url,
      path: storagePath,
      name: storedName,
      originalName: file.originalname,
      type: file.mimetype,
      size: file.size,
      bucket: bucket.name,
    },
  });
});
