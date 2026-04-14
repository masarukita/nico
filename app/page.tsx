// app/page.tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { QueryDocumentSnapshot, DocumentData } from "firebase/firestore";

import Header from "@/components/Header";
import PostCard from "@/components/PostCard";
import type { Post } from "@/types/post";
import { fetchPostsPage } from "@/lib/firebase/posts";

const PAGE_SIZE = 20;

export default function Home() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loadingFirst, setLoadingFirst] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  const [hasMore, setHasMore] = useState(true);
  const lastDocRef = useRef<QueryDocumentSnapshot<DocumentData> | null>(null);

  // 無限スクロール監視ターゲット
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const loadFirst = useCallback(async () => {
    try {
      setError("");
      setLoadingFirst(true);
      setLoadingMore(false);
      setHasMore(true);
      lastDocRef.current = null;

      const { posts: first, lastDoc } = await fetchPostsPage(PAGE_SIZE, null);

      setPosts(first);
      lastDocRef.current = lastDoc;

      // 次ページが無いなら hasMore=false
      if (!lastDoc || first.length < PAGE_SIZE) setHasMore(false);
    } catch (e: any) {
      setError(`取得に失敗しました: ${e?.message || String(e)}`);
    } finally {
      setLoadingFirst(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (loadingMore) return;
    if (!hasMore) return;

    const cursor = lastDocRef.current;
    if (!cursor) {
      setHasMore(false);
      return;
    }

    try {
      setError("");
      setLoadingMore(true);

      const { posts: next, lastDoc } = await fetchPostsPage(PAGE_SIZE, cursor);

      // 追加が0件なら終端
      if (next.length === 0) {
        setHasMore(false);
        lastDocRef.current = null;
        return;
      }

      // 重複排除して追記
      setPosts((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        const merged = [...prev];
        for (const p of next) {
          if (!seen.has(p.id)) merged.push(p);
        }
        return merged;
      });

      lastDocRef.current = lastDoc;

      // 次ページが無いなら hasMore=false
      if (!lastDoc || next.length < PAGE_SIZE) setHasMore(false);
    } catch (e: any) {
      setError(`追加取得に失敗しました: ${e?.message || String(e)}`);
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loadingMore]);

  // 初回ロード
  useEffect(() => {
    loadFirst();
  }, [loadFirst]);

  // IntersectionObserver で最下部に来たら loadMore
  useEffect(() => {
    if (!hasMore) return;           // もう無いなら監視不要
    if (loadingFirst) return;       // 初回ロード中は待つ

    const el = sentinelRef.current;
    if (!el) return;

    if (!("IntersectionObserver" in window)) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting) {
          loadMore();
        }
      },
      {
        root: null,
        rootMargin: "400px 0px", // 少し手前で読み込み開始
        threshold: 0,
      }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore, hasMore, loadingFirst]);

  return (
    <div>
      <Header />

      <div className="max-w-md mx-auto px-4 mt-2">
        {/* 初回ローディング */}
        {loadingFirst && (
          <div className="space-y-3">
            <div className="h-24 bg-gray-200 rounded-xl animate-pulse" />
            <div className="h-24 bg-gray-200 rounded-xl animate-pulse" />
            <div className="h-24 bg-gray-200 rounded-xl animate-pulse" />
          </div>
        )}

        {/* エラー */}
        {!loadingFirst && error && (
          <div className="bg-red-100 text-red-700 p-2 rounded-lg text-sm">
            {error}
          </div>
        )}

        {/* 0件 */}
        {!loadingFirst && !error && posts.length === 0 && (
          <div className="text-gray-400 text-center mt-10">
            まだ投稿がありません
            <div className="text-sm mt-2">右上の「投稿」から始めてみよう</div>
          </div>
        )}

        {/* 一覧 */}
        {!loadingFirst &&
          posts.map((p) => (
            <PostCard
              key={p.id}
              post={p}
              // リアクション後に最新表示へ戻す（簡易運用）
              onReactionChanged={loadFirst}
            />
          ))}

        {/* 追加読み込み中 */}
        {!loadingFirst && loadingMore && (
          <div className="mt-4 text-center text-gray-400 text-sm">
            読み込み中...
          </div>
        )}

        {/* 監視用sentinel（常に下に置く） */}
        <div ref={sentinelRef} className="h-1" />

        {/* 終端 */}
        {!loadingFirst && !loadingMore && !hasMore && posts.length > 0 && (
          <div className="mt-6 mb-6 text-center text-gray-300 text-sm">
            これ以上ありません
          </div>
        )}
      </div>
    </div>
  );
}
