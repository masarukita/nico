// types/comment.ts

import type { Timestamp } from "firebase/firestore";

export type Comment = {
  id: string;          // Firestore のドキュメントID
  postId: string;      // 紐づく投稿
  userId: string;      // 匿名ID
  content: string;     // コメント本文
  createdAt: Timestamp | null;
};