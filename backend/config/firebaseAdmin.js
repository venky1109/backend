const parseServiceAccount = () => {
  const base64ServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;

  if (!base64ServiceAccount && !rawServiceAccount) {
    return null;
  }

  const serviceAccountJson = base64ServiceAccount
    ? Buffer.from(base64ServiceAccount, 'base64').toString('utf8')
    : rawServiceAccount;

  const serviceAccount = JSON.parse(serviceAccountJson);

  if (serviceAccount.private_key) {
    serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
  }

  return serviceAccount;
};

const importFirebaseAdmin = async () => {
  try {
    const firebaseAdmin = await import('firebase-admin');
    return firebaseAdmin.default || firebaseAdmin;
  } catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND') {
      throw new Error('firebase-admin package is not installed');
    }

    throw error;
  }
};

const getFirebaseCredential = (admin) => {
  const serviceAccount = parseServiceAccount();

  if (serviceAccount) {
    return admin.credential.cert(serviceAccount);
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return admin.credential.applicationDefault();
  }

  throw new Error(
    'Firebase Admin credentials are not configured. Set FIREBASE_SERVICE_ACCOUNT_BASE64 or FIREBASE_SERVICE_ACCOUNT.'
  );
};

const getFirebaseApp = async () => {
  const admin = await importFirebaseAdmin();

  if (admin.apps.length) {
    return { admin, app: admin.app() };
  }

  const storageBucket =
    process.env.FIREBASE_STORAGE_BUCKET ||
    process.env.REACT_APP_FIREBASE_STORAGE_BUCKET;

  if (!storageBucket) {
    throw new Error('Firebase storage bucket is not configured');
  }

  const app = admin.initializeApp({
    credential: getFirebaseCredential(admin),
    storageBucket,
  });

  return { admin, app };
};

export const getFirebaseBucket = async () => {
  const { admin, app } = await getFirebaseApp();

  return admin.storage(app).bucket();
};
