// lib/firebase/admin.ts
import * as admin from "firebase-admin";

let app: admin.app.App | null = null;

function getPrivateKey() {
  const key = process.env.FIREBASE_PRIVATE_KEY;
  if (!key) return "";
  // .env.local では \n が文字列として入るので実改行に戻す
  return key.replace(/\\n/g, "\n");
}

export function getAdminApp() {
  if (app) return app;

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = getPrivateKey();

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "Firebase Admin env missing: FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY"
    );
  }

  // 既に初期化済みならそれを使う
  if (admin.apps.length) {
    app = admin.app();
    return app;
  }

  app = admin.initializeApp({
    credential: admin.credential.cert({
      projectId,
      clientEmail,
      privateKey,
    }),
  });

  return app;
}

export function getAdminDb() {
  return admin.firestore(getAdminApp());
}

export { admin };