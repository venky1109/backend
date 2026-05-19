import path from 'path';
import crypto from 'crypto';
import dns from 'dns/promises';
import net from 'net';
import { ProductImage } from '../../models/inventory/catalogImageModel.js';
import { getFirebaseBucket } from '../../config/firebaseAdmin.js';

const MAX_IMAGE_BYTES = Number(process.env.PRODUCT_IMAGE_MAX_BYTES || 40 * 1024);
const MAX_SOURCE_BYTES = Number(process.env.PRODUCT_IMAGE_SOURCE_MAX_BYTES || 8 * 1024 * 1024);
const IMAGE_PREFIX = process.env.FIREBASE_IMAGE_PREFIX || 'webpImages/';
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const PRIVATE_IPV4_RANGES = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^192\.168\./,
  /^0\./,
];

const buildFirebaseDownloadUrl = (bucketName, filePath, token) =>
  `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(
    filePath
  )}?alt=media&token=${token}`;

const sanitizeFilename = (filename = '') =>
  path
    .basename(filename, path.extname(filename))
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();

const isPrivateAddress = (address) => {
  if (!address) return true;

  if (net.isIPv4(address)) {
    return PRIVATE_IPV4_RANGES.some((range) => range.test(address));
  }

  if (net.isIPv6(address)) {
    const normalized = address.toLowerCase();
    return (
      normalized === '::1' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('fe80:')
    );
  }

  return true;
};

const assertSafeImageUrl = async (rawUrl) => {
  let parsed;

  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('A valid image URL is required');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only HTTP and HTTPS image URLs are allowed');
  }

  const records = await dns.lookup(parsed.hostname, { all: true });
  if (!records.length || records.some((record) => isPrivateAddress(record.address))) {
    throw new Error('Image URL host is not allowed');
  }

  return parsed;
};

const fetchImageUrl = async (rawUrl, redirectsRemaining = 4) => {
  const parsedUrl = await assertSafeImageUrl(rawUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  let response;
  try {
    response = await fetch(parsedUrl, {
      signal: controller.signal,
      redirect: 'manual',
      headers: {
        Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8,*/*;q=0.5',
        'User-Agent': 'MK-Backend-Product-Image-Uploader/1.0',
      },
    });
  } finally {
    clearTimeout(timeout);
  }

  if ([301, 302, 303, 307, 308].includes(response.status)) {
    if (redirectsRemaining <= 0) {
      throw new Error('Too many image URL redirects');
    }

    const location = response.headers.get('location');
    if (!location) {
      throw new Error('Image URL redirect is missing a location');
    }

    return fetchImageUrl(new URL(location, parsedUrl).toString(), redirectsRemaining - 1);
  }

  return { response, parsedUrl };
};

const readResponseBuffer = async (response) => {
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > MAX_SOURCE_BYTES) {
    throw new Error('Source image is too large');
  }

  const reader = response.body?.getReader?.();

  if (!reader) {
    const sourceBuffer = Buffer.from(await response.arrayBuffer());
    if (sourceBuffer.length > MAX_SOURCE_BYTES) {
      throw new Error('Source image is too large');
    }
    return sourceBuffer;
  }

  const chunks = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = Buffer.from(value);
    received += chunk.length;
    if (received > MAX_SOURCE_BYTES) {
      throw new Error('Source image is too large');
    }

    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
};

const loadSharp = async () => {
  try {
    const sharpModule = await import('sharp');
    return sharpModule.default || sharpModule;
  } catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND') {
      return null;
    }

    throw error;
  }
};

const webpBufferUnderLimit = async (buffer, { mimetype }) => {
  if (mimetype === 'image/webp' && buffer.length <= MAX_IMAGE_BYTES) {
    return buffer;
  }

  const sharp = await loadSharp();

  if (!sharp) {
    if (mimetype === 'image/webp') {
      throw new Error('WebP image is larger than 40 KB');
    }

    throw new Error('Server image conversion requires the sharp package');
  }

  const image = sharp(buffer, { failOn: 'none' }).rotate();
  const metadata = await image.metadata();
  const resizeOptions =
    metadata.width && metadata.width > 900
      ? { width: 900, withoutEnlargement: true }
      : undefined;

  for (const quality of [82, 72, 62, 52, 42, 34, 28, 22]) {
    const converted = await image
      .clone()
      .resize(resizeOptions)
      .webp({ quality, effort: 6 })
      .toBuffer();

    if (converted.length <= MAX_IMAGE_BYTES) {
      return converted;
    }
  }

  for (const width of [720, 560, 420, 320]) {
    const converted = await image
      .clone()
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: 28, effort: 6 })
      .toBuffer();

    if (converted.length <= MAX_IMAGE_BYTES) {
      return converted;
    }
  }

  throw new Error('Unable to compress image under 40 KB');
};

const uploadWebpToFirebase = async ({ buffer, originalName, uploadedBy }) => {
  const bucket = await getFirebaseBucket();
  const safeBaseName = sanitizeFilename(originalName) || 'product-image';
  const storedName = `${Date.now()}-${crypto.randomUUID()}-${safeBaseName}.webp`;
  const storagePath = `${IMAGE_PREFIX}${storedName}`;
  const downloadToken = crypto.randomUUID();
  const firebaseFile = bucket.file(storagePath);

  await firebaseFile.save(buffer, {
    contentType: 'image/webp',
    resumable: false,
    metadata: {
      contentDisposition: `inline; filename="${storedName}"`,
      metadata: {
        firebaseStorageDownloadTokens: downloadToken,
        originalName,
        uploadedBy: uploadedBy || '',
      },
    },
  });

  return {
    url: buildFirebaseDownloadUrl(bucket.name, storagePath, downloadToken),
    path: storagePath,
    name: storedName,
    size: buffer.length,
    bucket: bucket.name,
  };
};

export const searchProductImages = async (req, res, next) => {
  try {
    const { name = '', limit = 20 } = req.query;
    const images = await ProductImage.search({ name, limit });

    res.json({
      images,
      suggestions: images,
    });
  } catch (error) {
    next(error);
  }
};

export const uploadProductImage = async (req, res, next) => {
  try {
    const file = req.file;

    if (!file) {
      res.status(400);
      throw new Error('Image file is required');
    }

    if (!ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
      res.status(400);
      throw new Error('Only JPG, PNG, and WEBP images are allowed');
    }

    const webpBuffer = await webpBufferUnderLimit(file.buffer, {
      mimetype: file.mimetype,
    });
    const uploaded = await uploadWebpToFirebase({
      buffer: webpBuffer,
      originalName: file.originalname,
      uploadedBy: req.user?._id?.toString?.(),
    });

    res.status(201).json({
      message: 'Product image uploaded successfully',
      url: uploaded.url,
      imageUrl: uploaded.url,
      image: uploaded,
    });
  } catch (error) {
    next(error);
  }
};

export const uploadProductImageFromUrl = async (req, res, next) => {
  try {
    const imageUrl = req.body?.url || req.body?.imageUrl;
    const { response, parsedUrl } = await fetchImageUrl(imageUrl);

    if (!response.ok) {
      res.status(400);
      throw new Error(`Image download failed with status ${response.status}`);
    }

    const contentType = String(response.headers.get('content-type') || '').split(';')[0].toLowerCase();
    if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
      res.status(400);
      throw new Error('URL must point to a JPG, PNG, or WEBP image');
    }

    const sourceBuffer = await readResponseBuffer(response);
    const webpBuffer = await webpBufferUnderLimit(sourceBuffer, {
      mimetype: contentType,
    });
    const uploaded = await uploadWebpToFirebase({
      buffer: webpBuffer,
      originalName: path.basename(parsedUrl.pathname) || 'product-image',
      uploadedBy: req.user?._id?.toString?.(),
    });

    res.status(201).json({
      message: 'Product image uploaded successfully',
      url: uploaded.url,
      imageUrl: uploaded.url,
      image: uploaded,
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      res.status(408);
      next(new Error('Image download timed out'));
      return;
    }

    next(error);
  }
};
