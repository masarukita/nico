// lib/firebase/posts.ts

// Firestore操作に必要な関数を import
import {
  addDoc,
  collection,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase/firestore";

// Firestore(DB)インスタンス取得関数（あなたがStep2で作成したやつ）
import { getDb } from "@/lib/firebase/firestore";

// Post型（あなたがStep3で作った型定義）
import type { Post } from "@/types/post";

/**
 * Firestoreのコレクション名は固定
 * - ここを変えると全コードに影響するので定数化して事故防止
 */
const POSTS_COLLECTION = "posts";

/**
 * FirestoreのDocumentを Post型に変換する関数
 * - Firestoreは型がゆるいのでここで統一しておくと後がラク
 */
function convertPostDoc(docSnap: QueryDocumentSnapshot<DocumentData>): Post {
  const data = docSnap.data();

  return {
    id: docSnap.id,
    content: String(data.content ?? ""),
    userId: String(data.userId ?? ""),
    createdAt: data.createdAt ?? null, // serverTimestamp直後はnullになることがある
    reactionCounts: {
      wakaru: Number(data.reactionCounts?.wakaru ?? 0),
      sugoi: Number(data.reactionCounts?.sugoi ?? 0),
      erai: Number(data.reactionCounts?.erai ?? 0),
    },
    commentCount: Number(data.commentCount ?? 0),
  };
}

/**
 * ✅ 投稿を作成してFirestoreに保存する
 * - userId は匿名ID（Step1の anonUserId）
 * - createdAt は serverTimestamp（サーバー時刻）で保存
 */
export async function createPost(params: { content: string; userId: string }) {
  const db = getDb();

  // postsコレクション参照を作る
  const colRef = collection(db, POSTS_COLLECTION);

  // Firestoreに追加（addDoc）
  await addDoc(colRef, {
    content: params.content, // 投稿本文
    userId: params.userId,   // 匿名ID
    createdAt: serverTimestamp(),
    reactionCounts: { wakaru: 0, sugoi: 0, erai: 0 },
    commentCount: 0,
  });
}

/**
 * ✅ 投稿一覧を取得（新しい順）
 * - MVPなのでとりあえず全件取得
 * - createdAt desc で並べる
 */
export async function fetchPosts(): Promise<Post[]> {
  const db = getDb();

  // posts を createdAt の降順で取るクエリ
  const q = query(
    collection(db, POSTS_COLLECTION),
    orderBy("createdAt", "desc")
  );

  // Firestoreから取得
  const snap = await getDocs(q);

  // Post型に変換して返す
  return snap.docs.map(convertPostDoc);
}
``