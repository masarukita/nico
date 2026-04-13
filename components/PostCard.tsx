// components/PostCard.tsx
"use client";

import Link from "next/link";
import type { Timestamp } from "firebase/firestore";

import type { Post } from "@/types/post";
import { shortenId } from "@/utils/anonUser";
import ReactionButtons from "@/components/ReactionButtons";

/**
 * PostCard の props
 * - post: 表示する投稿データ
 * - onReactionChanged: リアクション後に親側で再取得したいときに使う
 * - showDetailLink:
 *    true  -> 一覧用（本文クリックで詳細へ / 「詳細を見る→」表示）
 *    false -> 詳細用（すでに詳細なのでリンク不要＆非表示）
 */
type Props = {
  post: Post;
  onReactionChanged?: () => void;
  showDetailLink?: boolean; // ★追加
};

/**
 * Firestore Timestamp を表示用文字列に変換
 */
function formatTimestamp(ts: Timestamp | null): string {
  if (!ts) return "";
  const d = ts.toDate();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}/${mm}/${dd} ${hh}:${mi}`;
}

export default function PostCard({
  post,
  onReactionChanged,
  showDetailLink = true, // ★デフォルトは一覧モード
}: Props) {
  const displayId = shortenId(post.userId);
  const createdAtText = formatTimestamp(post.createdAt);

  // 詳細URL（一覧モードだけで使う）
  const href = `/post/${post.id}`;

  return (
    <div className="bg-white rounded-xl shadow-sm p-4 mb-3">
      {/* 上段：ユーザーと時刻 */}
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">
          匿名ユーザー {displayId ? `(${displayId})` : ""}
        </div>
        {createdAtText && <div className="text-xs text-gray-400">{createdAtText}</div>}
      </div>

      {/* 本文：
          - 一覧（showDetailLink=true）: クリックで詳細へ
          - 詳細（showDetailLink=false）: リンク無しで表示
      */}
      {showDetailLink ? (
        <Link href={href} className="block">
          <div className="mt-2 text-base whitespace-pre-wrap leading-relaxed">
            {post.content}
          </div>
        </Link>
      ) : (
        <div className="mt-2 text-base whitespace-pre-wrap leading-relaxed">
          {post.content}
        </div>
      )}

      {/* リアクション（どっちの画面でも使う） */}
      <ReactionButtons postId={post.id} counts={post.reactionCounts} onChanged={onReactionChanged} />

      {/* 下段：コメント数・詳細リンク
          - コメント数リンクも一覧だけリンクにする（詳細ではもう不要）
          - 「詳細を見る→」は詳細ページでは非表示にする
      */}
      <div className="mt-2 text-xs text-gray-500 flex items-center justify-between">
        {showDetailLink ? (
          <Link href={href} className="hover:underline">
            💬 {post.commentCount}
          </Link>
        ) : (
          <div>💬 {post.commentCount}</div>
        )}

        {showDetailLink && (
          <Link href={href} className="text-gray-400 hover:underline">
            詳細を見る →
          </Link>
        )}
      </div>
    </div>
  );
}