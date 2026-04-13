// lib/firebase/comments.ts

import {
  collection,
  getDocs,
  orderBy,
  query,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase/firestore";

import { getDb } from "@/lib/firebase/firestore";
import type { Comment } from "@/types/comment";

const COMMENTS_COLLECTION = "comments";

/**
 * FirestoreのDoc→Comment型に変換
 */
function convert(docSnap: QueryDocumentSnapshot<DocumentData>): Comment {
  const data = docSnap.data();
  return {
    id: docSnap.id,
    postId: String(data.postId ?? ""),
    userId: String(data.userId ?? ""),
    content: String(data.content ?? ""),
    createdAt: data.createdAt ?? null,
  };
}

/**
 * 指定 postId のコメント一覧を取得（古い順）
 */
export async function fetchComments(postId: string): Promise<Comment[]> {
  const db = getDb();

  const q = query(
    collection(db, COMMENTS_COLLECTION),
    where("postId", "==", postId),
    orderBy("createdAt", "asc")
  );

  const snap = await getDocs(q);
  return snap.docs.map(convert);
}