// components/ReactionButtons.tsx
"use client";

import { useState } from "react";
import type { ReactionType } from "@/types/reaction";
import { toggleReaction } from "@/lib/firebase/reactions";
import { useAnonUserId } from "@/hooks/useAnonUserId";

/**
 * ReactionButtons が受け取る props
 * - postId: 対象投稿
 * - counts: 現在のカウント（表示用）
 * - onChanged: 反応後に親が再取得するためのコールバック（簡易に）
 */
type Props = {
  postId: string;
  counts: { wakaru: number; sugoi: number; erai: number };
  onChanged?: () => void;
};

export default function ReactionButtons({ postId, counts, onChanged }: Props) {
  // 匿名ID（誰が押したか）
  const { anonUserId } = useAnonUserId();

  // 送信中フラグ（二重押し防止）
  const [busy, setBusy] = useState(false);

  // エラー表示
  const [error, setError] = useState("");

  /**
   * ボタン押下時の処理
   */
  const handleClick = async (type: ReactionType) => {
    setError("");

    if (!anonUserId) {
      setError("ユーザーID準備中です。少し待ってください");
      return;
    }

    try {
      setBusy(true);

      // ✅ Firestore transaction で追加/上書き/削除
      await toggleReaction({
        postId,
        userId: anonUserId,
        newType: type,
      });

      // 親に「再取得してね」と伝える（MVP簡易）
      onChanged?.();
    } catch (e: any) {
      setError(`リアクション失敗: ${e?.message || String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {/* ボタン列 */}
      <div className="mt-3 flex gap-2">
        <button
          disabled={busy}
          onClick={() => handleClick("wakaru")}
          className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm disabled:opacity-50"
        >
          わかる {counts.wakaru}
        </button>

        <button
          disabled={busy}
          onClick={() => handleClick("sugoi")}
          className="px-3 py-1 bg-yellow-100 text-yellow-700 rounded-full text-sm disabled:opacity-50"
        >
          すごい {counts.sugoi}
        </button>

        <button
          disabled={busy}
          onClick={() => handleClick("erai")}
          className="px-3 py-1 bg-red-100 text-red-600 rounded-full text-sm disabled:opacity-50"
        >
          えらい {counts.erai}
        </button>
      </div>

      {/* エラー */}
      {error && (
        <div className="mt-2 bg-red-100 text-red-700 p-2 rounded-lg text-sm">
          {error}
        </div>
      )}
    </div>
  );
}