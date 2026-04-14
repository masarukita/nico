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

  // 無限スクロールの監視対象（ページ最下部の目印）
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const loadFirst = useCallback(async () => {
    try {
      setError("");
      setLoadingFirst(true);
      setHasMore(true);
      lastDocRef.current = null;

      const { posts: first, lastDoc } = await fetchPostsPage(PAGE_SIZE, null);

      setPosts(first);
      lastDocRef.current = lastDoc;

      // 次ページが無い（= 取得数が pageSize 未満）なら hasMore=false
      if (!lastDoc || first.length < PAGE_SIZE) setHasMore(false);
    } catch (e: any) {
      setError(`取得に失敗しました: ${e?.message || String(e)}`);
    } finally {
      setLoadingFirst(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    // 二重読み込み防止
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

      // 重複排除（念のため）
      setPosts((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        const merged = [...prev];
        for (const p of next) {
          if (!seen.has(p.id)) merged.push(p);
        }
        return merged;
      });

      lastDocRef.current = lastDoc;

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

  // IntersectionObserver で最下部まで来たら loadMore
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;

    // 対応してないブラウザ向けは“もっと見るボタン”でフォールバックできる
    if (!("IntersectionObserver" in window)) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry.isIntersecting) {
          loadMore();
        }
      },
      {
        root: null,
        // ちょっと手前で読み始める（体感が良い）
        rootMargin: "300px 0px",
        threshold: 0,
      }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore]);

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
              // リアクション後に再取得したいなら、ここは loadFirst() でもOK
              onReactionChanged={loadFirst}
            />
          ))}

        {/* 追加読み込み中 */}
        {!loadingFirst && loadingMore && (
          <div className="mt-4 text-center text-gray-400 text-sm">
            読み込み中...
          </div>
        )}

        {/* これが最下部検知用 */}
        <div ref={sentinelRef} className="h-1" />

        {/* フォールバック：もっと見る（Observer非対応/不安定な時） */}
        {!loadingFirst && hasMore && !("IntersectionObserver" in window) && (
          <div className="mt-4 text-center">
            <button
              onClick={loadMore}
              className="px-4 py-2 rounded-full bg-gray-100 text-gray-700"
            >
              もっと見る
            </button>
          </div>
        )}

        {/* 終端 */}
        {!loadingFirst && !hasMore && posts.length > 0 && (
          <div className="mt-6 mb-6 text-center text-gray-300 text-sm">
            これ以上ありません
          </div>
        )}
      </div>
    </div>
  );
}