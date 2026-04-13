// lib/firebase/client.ts

// Firebase アプリ初期化に必要な関数を import
import { initializeApp, getApps, type FirebaseApp } from "firebase/app";

// Firebase 設定情報（.env.local から読み込む）
// NOTE: NEXT_PUBLIC_ が付いていないとブラウザ側で参照できない
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!, // Firebase APIキー
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!, // 認証ドメイン
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!, // プロジェクトID（超重要）
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET!, // Storage（今回は未使用でもOK）
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!, // 送信者ID
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!, // アプリID
};

/**
 * Firebase App を取得する関数
 *
 * なぜ getApps() するの？
 * - Next.js の開発モードでは Fast Refresh でコードが何度も再評価される
 * - initializeApp を複数回やると「すでに初期化済み」エラーになる
 * - そのため「既にあればそれを使う」設計にする
 */
export function getFirebaseApp(): FirebaseApp {
  // すでに初期化済みの Firebase App がある場合はそれを返す
  if (getApps().length > 0) {
    return getApps()[0];
  }

  // 初回のみ Firebase App を初期化して返す
  return initializeApp(firebaseConfig);
}