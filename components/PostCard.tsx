// components/PostCard.tsx
"use client";

import React, { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Post } from "@/types/post";
import { timeAgo } from "@/utils/timeAgo";

type Props = {
  post: Post;
  onReactionChanged?: () => void;   // 互換のため残す（♡では呼ばない）
  showDetailLink?: boolean;         // 互換のため残す（使わない）
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

function IconShareBoxUp({
  className = "",
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      className={className}
      style={style}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path d="M12 4.2v8.25" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path
        d="M9.0 6.6 12 3.6 15.0 6.6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path
        d="M6.0 12.8v2.4A1.7 1.7 0 0 0 7.7 16.9h8.6A1.7 1.7 0 0 0 18.0 15.2v-2.4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function PostCard({ post, onReactionChanged }: Props) {
  const router = useRouter();

  const userId = String(post?.userId ?? "");
  const displayName = "Anonymous";
  const handle = userId ? `@${shortId(userId)}` : "@anon";
  const when = timeAgo((post as any)?.createdAt);

  const avatarColor = useMemo(() => colorFromId(userId || post.id), [userId, post.id]);

  const content = String(post?.content ?? "");
  const { head, tail } = useMemo(() => clampText(content, 320), [content]);
  const [expanded, setExpanded] = useState(false);

  const replyCount = Number(post?.commentCount ?? 0);

  // ✅ Like状態は1つにまとめる（StrictModeでも安全）
  const [like, setLike] = useState(() => ({
    liked: false,
    count: Number(post?.reactionCounts?.wakaru ?? 0),
  }));

  const [heartBump, setHeartBump] = useState(false);

  const goDetail = () => router.push(`/post/${post.id}`);

  const toggleLikeLocalOnly = () => {
    // ✅ 必ず動作確認できるログ
    console.log("[LIKE] clicked", post.id);

    // ✅ ここは「UIが確実に変わる」ことを優先
    setLike((prev) => {
      const nextLiked = !prev.liked;
      return { liked: nextLiked, count: prev.count + (nextLiked ? 1 : -1) };
    });

    // pop animation
    setHeartBump(false);
    requestAnimationFrame(() => setHeartBump(true));

    // ★ ここでは親再取得を呼ばない（呼ぶと即リセットされるケースがある）
    // onReactionChanged?.();
  };

  const onShare = async () => {
    const url = `${window.location.origin}/post/${post.id}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "nico", text: content.slice(0, 80), url });
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        alert("リンクをコピーしました");
      } else {
        alert(url);
      }
    } catch {
      // キャンセル等は無視
    }
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

      {/* 本文クリックで詳細（アクションとは完全分離） */}
      <div
        role="button"
        tabIndex={0}
        onClick={goDetail}
        className="px-3 py-3 flex gap-3 cursor-pointer"
      >
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

          {/* ✅ Like：ここで絶対に遷移させない＆必ずstateが変わる */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              toggleLikeLocalOnly();
            }}
            className={`flex items-center gap-1 leading-none ${
              like.liked ? "text-pink-600" : "text-gray-500 hover:text-gray-900"
            }`}
            aria-label="Like"
          >
            <span
              className={`text-[16px] leading-none ${heartBump ? "nico-heart-pop" : ""}`}
              onAnimationEnd={() => setHeartBump(false)}
            >
              {like.liked ? "❤️" : "♡"}
            </span>
            <span className="text-xs tabular-nums">{like.count}</span>
          </button>

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