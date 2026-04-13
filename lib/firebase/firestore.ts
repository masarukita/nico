// lib/firebase/firestore.ts

// Firestore（DB）機能を import
import { getFirestore, type Firestore } from "firebase/firestore";

// Firebase App を取得する自作関数を import
import { getFirebaseApp } from "./client";

/**
 * Firestore（DB）インスタンス取得関数
 * - アプリ全体で「この関数だけ」を使ってDBを触るようにする
 * - こうしておくと後から差し替え・拡張が楽
 */
export function getDb(): Firestore {
  // Firebase App を取得（なければ初期化される）
  const app = getFirebaseApp();

  // Firestore インスタンスを取得して返す
  return getFirestore(app);
}