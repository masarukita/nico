// lib/firebase/posts.ts
import {
  collection,
  addDoc,
  serverTimestamp,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  QueryDocumentSnapshot,
  DocumentData,
} from "firebase/firestore";

import { getDb } from "@/lib/firebase/firestore";
import type { Post } from "@/types/post";

export const POSTS_PAGE_SIZE_DEFAULT = 20;

export type FetchPostsPageResult = {
  posts: Post[];
  lastDoc: QueryDocumentSnapshot<DocumentData> | null;
};

function toPost(docSnap: QueryDocumentSnapshot<DocumentData>): Post {
  const data = docSnap.data() as any;

  return {
    id: docSnap.id,
    content: String(data.content ?? ""),
    userId: String(data.userId ?? ""),
    createdAt: data.createdAt ?? null,
    reactionCounts: {
      wakaru: Number(data.reactionCounts?.wakaru ?? 0),
      sugoi: Number(data.reactionCounts?.sugoi ?? 0),
      erai: Number(data.reactionCounts?.erai ?? 0),
    },
    commentCount: Number(data.commentCount ?? 0),
  };
}

/**
 * 投稿を新しい順にページ単位で取得（無限スクロール用）
 */
export async function fetchPostsPage(
  pageSize: number = POSTS_PAGE_SIZE_DEFAULT,
  cursor: QueryDocumentSnapshot<DocumentData> | null = null
): Promise<FetchPostsPageResult> {
  const db = getDb();
  const postsRef = collection(db, "posts");

  const q = cursor
    ? query(postsRef, orderBy("createdAt", "desc"), startAfter(cursor), limit(pageSize))
    : query(postsRef, orderBy("createdAt", "desc"), limit(pageSize));

  const snap = await getDocs(q);

  const posts = snap.docs.map(toPost);
  const lastDoc = snap.docs.length > 0 ? snap.docs[snap.docs.length - 1] : null;

  return { posts, lastDoc };
}

/**
 * 新規投稿を作成
 * - createdAt: serverTimestamp() でサーバー時刻を入れる
 * - reactionCounts/commentCount は初期値を入れる
 */
export async function createPost(params: {
  content: string;
  userId: string;
}): Promise<string> {
  const db = getDb();
  const postsRef = collection(db, "posts");

  const content = params.content.trim();
  const userId = params.userId.trim();

  if (!content) throw new Error("content is empty");
  if (!userId) throw new Error("userId is empty");

  const docRef = await addDoc(postsRef, {
    content,
    userId,
    createdAt: serverTimestamp(),
    reactionCounts: { wakaru: 0, sugoi: 0, erai: 0 },
    commentCount: 0,
  });

  return docRef.id;
}