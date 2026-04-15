// lib/firebase/admin.ts
import admin from "firebase-admin";

function getPrivateKey(): string {
  const key = process.env.FIREBASE_PRIVATE_KEY;
  if (!key) return "";
  // Vercel等で \n が文字として入るので実改行に戻す
  return key.replace(/\\n/g, "\n");
}

export function getAdminDb() {
  if (!admin.apps.length) {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = getPrivateKey();

    if (!projectId || !clientEmail || !privateKey) {
      throw new Error(
        "Firebase Admin env missing: FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY"
      );
    }

    admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey,
      }),
    });
  }

  return admin.firestore();
}

export { admin };