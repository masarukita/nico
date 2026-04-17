// components/PostCard.tsx
"use client";

import React, { useMemo, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { Post } from "@/types/post";
import { timeAgo } from "@/utils/timeAgo";
import { useAnonUserId } from "@/hooks/useAnonUserId";

type Props = {
  post: Post;

  // 互換（既存が渡してても型で落ちない）
  onReactionChanged?: () => void | Promise<void>;
  showDetailLink?: boolean; // 互換（UIでは使わない）
};

function shortId(id: string) {
  const s = String(id ?? "");
  if (!s) return "";
  if (s.length <= 10) return s;
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

function colorFromId(id: string) {
  const s = String(id ?? "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue} 70% 55%)`;
}

function clampText(text: string, max = 320) {
  const t = String(text ?? "");
  if (t.length <= max) return { head: t, tail: "" };
  return { head: t.slice(0, max), tail: t.slice(max) };
}

// 共有（あなたの確定版）
function IconShareBoxUp({ className = "" }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 4.2v8.25" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M9.0 6.6 12 3.6 15.0 6.6" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
      <path d="M6.0 12.8v2.4A1.7 1.7 0 0 0 7.7 16.9h8.6A1.7 1.7 0 0 0 18.0 15.2v-2.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export default function PostCard({ post }: Props) {
  const router = useRouter();
  const { anonUserId } = useAnonUserId();

  const postId = String(post?.id ?? "");
  const authorId = String(post?.userId ?? "");

  const displayName = "Anonymous";
  const handle = authorId ? `@${shortId(authorId)}` : "@anon";
  const when = timeAgo((post as any)?.createdAt);

  const avatarColor = useMemo(() => colorFromId(authorId || postId), [authorId, postId]);

  const content = String(post?.content ?? "");
  const { head, tail } = useMemo(() => clampText(content, 320), [content]);
  const [expanded, setExpanded] = useState(false);

  const replyCount = Number(post?.commentCount ?? 0);

  // ✅ countはpostsから。likedは後で /api/reactions/status で復元する
  const [like, setLike] = useState(() => ({
    liked: false,
    count: Number(post?.reactionCounts?.wakaru ?? 0),
  }));

  // 投稿リストが再取得された時に count を追随（表示のズレ防止）
  useEffect(() => {
    setLike((prev) => ({
      ...prev,
      count: Number(post?.reactionCounts?.wakaru ?? 0),
    }));
  }, [post?.reactionCounts?.wakaru]);

  // ✅ 自分が押しているか（❤️）を復元：Xと同じ挙動の本体
  const [likedLoaded, setLikedLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;

    async function loadLiked() {
      if (!anonUserId || !postId) return;
      try {
        const qs = new URLSearchParams({ postId, userId: anonUserId }).toString();
        const res = await fetch(`/api/reactions/status?${qs}`, { method: "GET" });
        const text = await res.text().catch(() => "");
        const json = text ? JSON.parse(text) : null;
        if (!cancelled && json?.ok === true) {
          setLike((prev) => ({ ...prev, liked: Boolean(json.liked) }));
        }
      } catch {
        // 失敗時は何もしない（白抜きのまま）
      } finally {
        if (!cancelled) setLikedLoaded(true);
      }
    }

    setLikedLoaded(false);
    loadLiked();

    return () => {
      cancelled = true;
    };
  }, [anonUserId, postId]);

  // ハートポップ
  const [heartBump, setHeartBump] = useState(false);
  const [liking, setLiking] = useState(false);

  const goDetail = () => router.push(`/post/${postId}`);

  async function safeReadJson(res: Response): Promise<any | null> {
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      try {
        return await res.json();
      } catch {
        return null;
      }
    }
    try {
      const text = await res.text();
      return { _nonJson: true, text };
    } catch {
      return null;
    }
  }

  // ✅ 永続化トグル（postsのCount更新 + reactions doc 作成/削除）
  const toggleLikePersist = async () => {
    if (liking) return;
    if (!anonUserId) return;

    setHeartBump(false);
    requestAnimationFrame(() => setHeartBump(true));

    setLiking(true);
    try {
      const res = await fetch("/api/reactions/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId, userId: anonUserId, type: "like" }),
      });

      const json = await safeReadJson(res);

      if (!res.ok || !json || json.ok !== true) {
        console.error("[like] toggle failed:", res.status, json);
        // フォールバック（見た目だけ）
        setLike((prev) => {
          const nextLiked = !prev.liked;
          return { liked: nextLiked, count: prev.count + (nextLiked ? 1 : -1) };
        });
        return;
      }

      // ✅ サーバ確定値で更新：countもlikedも整合する
      setLike({ liked: Boolean(json.liked), count: Number(json.count) });
    } finally {
      setLiking(false);
    }
  };

  const onShare = async () => {
    const url = `${window.location.origin}/post/${postId}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "nico", text: content.slice(0, 80), url });
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        alert("リンクをコピーしました");
      } else {
        alert(url);
      }
    } catch {}
  };

  return (
    <article className="border-b border-gray-200">
      <style jsx global>{`
        @keyframes nico-heart-pop {
          0% { transform: scale(1); }
          20% { transform: scale(0.85); }
          55% { transform: scale(1.25); }
          75% { transform: scale(0.95); }
          100% { transform: scale(1); }
        }
        .nico-heart-pop {
          animation: nico-heart-pop 260ms cubic-bezier(.2,.8,.2,1);
        }
      `}</style>

      {/* 本文クリックで詳細 */}
      <div role="button" tabIndex={0} onClick={goDetail} className="px-3 py-3 flex gap-3 cursor-pointer">
        <div className="shrink-0">
          <div className="h-10 w-10 rounded-full" style={{ background: avatarColor }} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[13px] leading-4">
            <span className="font-semibold text-gray-900">{displayName}</span>
            <span className="text-gray-500">{handle}</span>
            {when && <span className="text-gray-400">· {when}</span>}
          </div>

          <div className="mt-1 text-[15px] leading-5 text-gray-900 whitespace-pre-wrap break-words">
            {expanded ? content : head}
            {!expanded && tail && (
              <>
                …{" "}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpanded(true);
                  }}
                  className="text-gray-600 font-semibold hover:underline"
                >
                  もっと見る
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* アクション行 */}
      <div className="px-3 pb-3">
        <div className="ml-[52px] max-w-[320px] flex items-center justify-between">
          {/* 💬 */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              goDetail();
            }}
            className="flex items-center gap-1 text-gray-500 hover:text-gray-900 active:text-gray-900 leading-none"
            aria-label="Reply"
          >
            <span className="text-[16px] leading-none">💬</span>
            <span className="text-xs tabular-nums">{replyCount}</span>
          </button>

          {/* ❤️ */}
          <button
            type="button"
            disabled={liking || !anonUserId}
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              toggleLikePersist();
            }}
            className={`flex items-center gap-1 leading-none ${
              like.liked ? "text-pink-600" : "text-gray-500 hover:text-gray-900"
            } ${(liking || !anonUserId) ? "opacity-60" : ""}`}
            aria-label="Like"
            title={!likedLoaded ? "loading..." : undefined}
          >
            <span className={`text-[16px] leading-none ${heartBump ? "nico-heart-pop" : ""}`}>
              {like.liked ? "❤️" : "♡"}
            </span>
            <span className="text-xs tabular-nums">{like.count}</span>
          </button>

          {/* 共有（1px下げ） */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onShare();
            }}
            className="flex items-center gap-1 text-gray-500 hover:text-gray-900 active:text-gray-900 leading-none"
            aria-label="Share"
          >
            <IconShareBoxUp className="block translate-y-[1px]" />
          </button>
        </div>
      </div>
    </article>
  );
}