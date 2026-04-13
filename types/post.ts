// types/post.ts

import type { Timestamp } from "firebase/firestore";

/**
 * Firestore に保存する Post（投稿）データの型
 * - Firestore の Timestamp を使う（createdAt）
 */
export type Post = {
  /** Firestore のドキュメントID（取得時に付ける） */
  id: string;

  /** 投稿本文（1〜140 など） */
  content: string;

  /** 匿名ID（Step1の anonUserId） */
  userId: string;

  /**
   * 作成日時（Firestoreの serverTimestamp() を使う想定）
   * - 作成直後やデータ欠損では null になり得る
   */
  createdAt: Timestamp | null;

  /**
   * リアクション数（posts側に集計して持つ）
   * - タイムラインでの表示が高速になる
   */
  reactionCounts: {
    wakaru: number;
    sugoi: number;
    erai: number;
  };

  /** コメント数（Step5で増やす） */
  commentCount: number;
};

/**
 * ✅ 重要：実行時にも残る export を1つ置いて「確実に module 化」する
 * - Vercel/型チェックで「is not a module」が出る環境差を潰すための“保険”
 * - この定数はアプリ動作には影響しない（参照しなくてもOK）
 */
export const POST_MODULE_MARKER = "post-module" as const;