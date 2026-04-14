// app/post/[id]/PostDetailClient.tsx
"use client";

import Link from "next/link";
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

type Props = {
  postId: string;
};

export default function PostDetailClient({ postId }: Props) {
  const db = getDb();

  const [post, setPost] = useState<Post | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadPost = useCallback(async () => {
    // ✅ ガード：postIdが無ければdoc()を呼ばない（indexOfエラー回避）
    if (!postId) {
      throw new Error("postId が未設定です（/post/[id] の id が渡っていません）");
    }

    const ref = doc(db, "posts", postId);
    const snap = await getDoc(ref);

    if (!snap.exists()) {
      throw new Error("投稿が見つかりません");
    }

    const data = snap.data() as any;
    const p: Post = {
      id: snap.id,
      content: String(data?.content ?? ""),
      userId: String(data?.userId ?? ""),
      createdAt: data?.createdAt ?? null,
      reactionCounts: {
        wakaru: Number(data?.reactionCounts?.wakaru ?? 0),
        sugoi: Number(data?.reactionCounts?.sugoi ?? 0),
        erai: Number(data?.reactionCounts?.erai ?? 0),
      },
      commentCount: Number(data?.commentCount ?? 0),
    };

    setPost(p);
  }, [db, postId]);

  const loadComments = useCallback(async () => {
    if (!postId) return;
    const list = await fetchComments(postId);
    setComments(Array.isArray(list) ? list : []);
  }, [postId]);

  useEffect(() => {
    const init = async () => {
      try {
        setLoading(true);
        setError("");

        await loadPost();
        await loadComments();
      } catch (e: any) {
        // ✅ Consoleに必ず出す（今後の特定用）
        console.error("[PostDetailClient:init] error:", e);
        setError(e?.message || String(e));
      } finally {
        setLoading(false);
      }
    };

    init();
  }, [loadPost, loadComments]);

  const onCommentSubmitted = async () => {
    try {
      await loadComments();
      await loadPost();
    } catch (e: any) {
      console.error("[PostDetailClient:onCommentSubmitted] error:", e);
      setError(e?.message || String(e));
    }
  };

  return (
    <div>
      <Header />

      <div className="max-w-md mx-auto px-4 mt-2">
        <div className="mb-2">
          <Link
            href="/"
            className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 hover:underline"
          >
            ← トップに戻る
          </Link>
        </div>

        {loading && <div className="text-gray-400">読み込み中...</div>}

        {!!error && (
          <div className="bg-red-100 text-red-700 p-2 rounded-lg text-sm">
            {error}
          </div>
        )}

        {!loading && !error && post && (
          <>
            <PostCard
              post={post}
              onReactionChanged={loadPost}
              showDetailLink={false}
            />

            <CommentList comments={comments} />

            <CommentInput
              postId={postId}
              postContent={post.content}
              onSubmitted={onCommentSubmitted}
            />
          </>
        )}
      </div>
    </div>
  );
}
``