// types/reaction.ts

import type { Timestamp } from "firebase/firestore";

/**
 * リアクション種別（MVP固定）
 */
export type ReactionType = "wakaru" | "sugoi" | "erai";

/**
 * Firestore に保存する Reaction データの型
 */
export type Reaction = {
  id: string;       // ドキュメントID（postId_userId）
  postId: string;   // 対象投稿ID
  userId: string;   // 匿名ID
  type: ReactionType;
  createdAt: Timestamp | null;
};