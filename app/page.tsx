// app/page.tsx
"use client";

import { useCallback, useEffect, useState } from "react";

import Header from "@/components/Header";
import PostCard from "@/components/PostCard";

import { fetchPosts } from "@/lib/firebase/posts";
import type { Post } from "@/types/post";

export default function Home() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadPosts = useCallback(async () => {
    try {
      setError("");
      setLoading(true);
      const data = await fetchPosts();
      setPosts(data);
    } catch (e: any) {
      setError(`取得に失敗しました: ${e?.message || String(e)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPosts();
  }, [loadPosts]);

  return (
    <div>
      <Header />

      <div className="max-w-md mx-auto px-4 mt-2">
        {loading && (
          <div className="space-y-3">
            <div className="h-24 bg-gray-200 rounded-xl animate-pulse" />
            <div className="h-24 bg-gray-200 rounded-xl animate-pulse" />
          </div>
        )}

        {error && (
          <div className="bg-red-100 text-red-700 p-2 rounded-lg text-sm">
            {error}
          </div>
        )}

        {!loading && !error && posts.length === 0 && (
          <div className="text-gray-400 text-center mt-10">
            まだ投稿がありません
            <div className="text-sm mt-2">右上の「投稿」から始めてみよう</div>
          </div>
        )}

        {!loading &&
          !error &&
          posts.map((p) => (
            <PostCard
              key={p.id}
              post={p}
              // リアクション後に再取得（MVP簡易）
              onReactionChanged={loadPosts}
              // showDetailLink は渡さない → デフォルト true（一覧モード）
            />
          ))}
      </div>
    </div>
  );
}
