// app/post/[id]/PostDetailClient.tsx
"use client";

import Link from "next/link"; // ✅ 追加：トップに戻るリンク用
import { useCallback, useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";

import Header from "@/components/Header";
import PostCard from "@/components/PostCard";
import CommentList from "@/components/CommentList";
import CommentInput from "@/components/CommentInput";

import { getDb } from "@/lib/firebase/firestore";
import { fetchComments } from "@/lib/firebase/comments";

import type { Post } from "@/types/post";
import type { Comment } from "@/types/comment";

/**
 * Server Component (page.tsx) から渡される props
 */
type Props = {
  postId: string;
};

/**
 * 投稿詳細画面（クライアント側）
 * - Firestore から投稿を取得して表示
 * - Firestore からコメント一覧を取得して表示
 * - コメント送信 / リアクション後に再取得してUI更新
 */
export default function PostDetailClient({ postId }: Props) {
  // Firestore インスタンス
  const db = getDb();

  // 投稿データ
  const [post, setPost] = useState<Post | null>(null);

  // コメント一覧
  const [comments, setComments] = useState<Comment[]>([]);

  // ローディング
  const [loading, setLoading] = useState(true);

  // エラー表示
  const [error, setError] = useState("");

  /**
   * posts/{postId} を取得して Post 型に整形して state に入れる
   */
  const loadPost = useCallback(async () => {
    // ドキュメント参照（postsコレクションの中の postId）
    const ref = doc(db, "posts", postId);

    // Firestore から1件取得
    const snap = await getDoc(ref);

    // 存在しないならエラー（UI側で表示）
    if (!snap.exists()) {
      throw new Error("投稿が見つかりません");
    }

    // Firestoreのdataは型がゆるいので any で受けて整形する
    const data = snap.data() as any;

    // Post 型に合わせて安全に整形
    const p: Post = {
      id: snap.id,
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

    // state更新
    setPost(p);
  }, [db, postId]);

  /**
   * comments を postId で絞り込んで取得して state に入れる
   */
  const loadComments = useCallback(async () => {
    const list = await fetchComments(postId);
    setComments(list);
  }, [postId]);

  /**
   * 初回ロード（投稿 + コメント）
   */
  useEffect(() => {
    const init = async () => {
      try {
        setLoading(true);
        setError("");

        await loadPost();
        await loadComments();
      } catch (e: any) {
        setError(e?.message || String(e));
      } finally {
        setLoading(false);
      }
    };

    init();
  }, [loadPost, loadComments]);

  /**
   * コメント送信後に呼ばれる
   * - コメント一覧を再取得
   * - 投稿も再取得（commentCountが増えるため）
   */
  const onCommentSubmitted = async () => {
    try {
      await loadComments();
      await loadPost(); // commentCount 反映のため
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  };

  return (
    <div>
      <Header />

      <div className="max-w-md mx-auto px-4 mt-2">
        {/* ✅ トップに戻るボタン（詳細ページだけに表示） */}
        <div className="mb-2">
          <Link
            href="/"
            className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 hover:underline"
          >
            ← トップに戻る
          </Link>
        </div>

        {/* ローディング */}
        {loading && <div className="text-gray-400">読み込み中...</div>}

        {/* エラー */}
        {error && (
          <div className="bg-red-100 text-red-700 p-2 rounded-lg text-sm">
            {error}
          </div>
        )}

        {/* 正常表示 */}
        {!loading && !error && post && (
          <>
            {/* ✅ 詳細ページでは showDetailLink={false} で「詳細を見る→」を消す */}
            <PostCard
              post={post}
              onReactionChanged={loadPost}
              showDetailLink={false}
            />

            {/* コメント一覧 */}
            <CommentList comments={comments} />

            {/* コメント入力（送信後に再取得） */}
            <CommentInput
              postId={postId}
              postContent={post.content} // ✅ 文脈として投稿本文をAI判定へ渡す
              onSubmitted={onCommentSubmitted}
            />
          </>
        )}
      </div>
    </div>
  );
}