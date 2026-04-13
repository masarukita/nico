// lib/firebase/reactions.ts

import {
  doc,
  runTransaction,
  serverTimestamp,
  type DocumentData,
} from "firebase/firestore";

import { getDb } from "@/lib/firebase/firestore";
import type { ReactionType } from "@/types/reaction";

/**
 * コレクション名（固定）
 */
const POSTS_COLLECTION = "posts";
const REACTIONS_COLLECTION = "reactions";

/**
 * reactions のドキュメントIDを作る（1ユーザー1投稿を強制）
 * 例: postId="abc", userId="u1" → "abc_u1"
 */
function buildReactionDocId(postId: string, userId: string): string {
  return `${postId}_${userId}`;
}

/**
 * reactionCounts のどのキーを増減するか（型安全）
 */
const REACTION_KEYS: ReactionType[] = ["wakaru", "sugoi", "erai"];

/**
 * ✅ リアクションをトグル（追加/上書き/削除）する
 *
 * 挙動:
 * - 既にリアクションが無い → 追加（newType +1）
 * - 同じリアクションがある → 削除（oldType -1）
 * - 別のリアクションがある → 上書き（oldType -1, newType +1）
 *
 * すべて transaction の中で行うことで
 * - posts カウント
 * - reactions ドキュメント
 * の整合性を保つ
 */
export async function toggleReaction(params: {
  postId: string;
  userId: string;
  newType: ReactionType;
}) {
  const db = getDb();

  // posts/{postId}
  const postRef = doc(db, POSTS_COLLECTION, params.postId);

  // reactions/{postId_userId}
  const reactionId = buildReactionDocId(params.postId, params.userId);
  const reactionRef = doc(db, REACTIONS_COLLECTION, reactionId);

  // transaction 実行
  await runTransaction(db, async (tx) => {
    // 1) 現在のpostを取得
    const postSnap = await tx.get(postRef);
    if (!postSnap.exists()) {
      throw new Error("対象の投稿が存在しません");
    }

    // 2) 現在のreaction（そのユーザーのその投稿）を取得
    const reactionSnap = await tx.get(reactionRef);

    // posts 側の現在カウントを安全に取り出す
    const postData = postSnap.data() as DocumentData;
    const currentCounts = postData.reactionCounts ?? {};
    const counts: Record<ReactionType, number> = {
      wakaru: Number(currentCounts.wakaru ?? 0),
      sugoi: Number(currentCounts.sugoi ?? 0),
      erai: Number(currentCounts.erai ?? 0),
    };

    // 3) パターン分岐
    if (!reactionSnap.exists()) {
      // --- (A) リアクション無し → 追加 ---
      counts[params.newType] += 1;

      // reactions ドキュメント作成
      tx.set(reactionRef, {
        postId: params.postId,
        userId: params.userId,
        type: params.newType,
        createdAt: serverTimestamp(),
      });

      // posts のカウント更新
      tx.update(postRef, { reactionCounts: counts });
      return;
    }

    // 既存リアクションあり
    const reactionData = reactionSnap.data() as DocumentData;
    const oldType = reactionData.type as ReactionType;

    if (oldType === params.newType) {
      // --- (B) 同じタイプ → 取り消し ---
      counts[oldType] = Math.max(0, counts[oldType] - 1);

      // reactions ドキュメント削除
      tx.delete(reactionRef);

      // posts のカウント更新
      tx.update(postRef, { reactionCounts: counts });
      return;
    }

    // --- (C) 別タイプ → 上書き ---
    // 古いのを減らす
    counts[oldType] = Math.max(0, counts[oldType] - 1);
    // 新しいのを増やす
    counts[params.newType] += 1;

    // reactions を上書き
    tx.set(
      reactionRef,
      {
        postId: params.postId,
        userId: params.userId,
        type: params.newType,
        createdAt: serverTimestamp(),
      },
      { merge: true }
    );

    // posts のカウント更新
    tx.update(postRef, { reactionCounts: counts });
  });
}
