// app/post/new/page.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { useAnonUserId } from "@/hooks/useAnonUserId";
import { createPost } from "@/lib/firebase/posts";

/**
 * ローカルで最小レート制限するためのキー
 * - 本当はサーバー側でやるのが理想だが、MVPではまずローカル防御
 */
const LAST_POST_TS_KEY = "lastPostTimestamp";

/**
 * 文字数制限（MVP仕様）
 */
const MIN_LEN = 1;
const MAX_LEN = 140;

/**
 * 投稿ページ
 * - テキスト入力
 * - バリデーション
 * - レート制限（1分1回）
 * - Firestoreに保存
 * - 保存後にトップへ戻す
 */
export default function NewPostPage() {
  const router = useRouter();

  // 匿名ID（ユーザー識別用）
  const { anonUserId } = useAnonUserId();

  // 入力内容
  const [content, setContent] = useState("");

  // 送信中フラグ（二重投稿防止）
  const [isSubmitting, setIsSubmitting] = useState(false);

  // エラー表示用
  const [error, setError] = useState<string>("");

  /**
   * 投稿前の簡易バリデーション
   */
  const validate = (text: string): string | null => {
    const trimmed = text.trim();

    // 空チェック
    if (trimmed.length < MIN_LEN) return "投稿内容を入力してください";

    // 文字数チェック
    if (trimmed.length > MAX_LEN) return `投稿は${MAX_LEN}文字以内です`;

    return null; // OK
  };

  /**
   * ローカルレート制限（1分1回）
   * - localStorage に最後に投稿した時刻を保存して、早すぎたら弾く
   */
  const checkRateLimit = (): string | null => {
    const now = Date.now();

    // 前回投稿時刻の取得
    const last = localStorage.getItem(LAST_POST_TS_KEY);
    if (!last) return null; // 初回はOK

    const lastNum = Number(last);
    const diffMs = now - lastNum;

    // 60秒未満ならNG
    if (diffMs < 60_000) {
      const remain = Math.ceil((60_000 - diffMs) / 1000);
      return `投稿は1分に1回までです（あと${remain}秒）`;
    }

    return null; // OK
  };

  /**
   * 実際の投稿処理
   */
  const handleSubmit = async () => {
    setError("");

    // 匿名IDがまだ取れていなければ待つ（useEffectで取るため最初は空の場合あり）
    if (!anonUserId) {
      setError("ユーザーIDを準備中です。少し待ってから再度お試しください");
      return;
    }

    // バリデーション
    const v = validate(content);
    if (v) {
      setError(v);
      return;
    }

    // レート制限
    const r = checkRateLimit();
    if (r) {
      setError(r);
      return;
    }

    try {
      setIsSubmitting(true);

      // Firestore に保存
      await createPost({ content: content.trim(), userId: anonUserId });

      // 成功したら「最後の投稿時刻」を保存（レート制限用）
      localStorage.setItem(LAST_POST_TS_KEY, String(Date.now()));

      // トップへ戻る（タイムラインに表示される想定）
      router.push("/");
    } catch (e: any) {
      setError(`投稿に失敗しました: ${e?.message || String(e)}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-md mx-auto p-4">
      {/* 見出し */}
      <h1 className="text-lg font-semibold mb-3">投稿する</h1>

      {/* 入力欄 */}
      <textarea
        className="w-full h-40 p-3 border rounded-xl focus:outline-none focus:ring-2 focus:ring-[#6FCF97]"
        placeholder="今の気持ちや、頑張ったことをシェアしてみよう！"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        maxLength={MAX_LEN}
      />

      {/* 残り文字数表示（UX改善） */}
      <div className="text-xs text-gray-500 mt-1 text-right">
        {content.trim().length}/{MAX_LEN}
      </div>

      {/* エラー表示 */}
      {error && (
        <div className="mt-2 bg-red-100 text-red-700 p-2 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* 投稿ボタン */}
      <button
        onClick={handleSubmit}
        disabled={isSubmitting}
        className="mt-3 w-full bg-[#6FCF97] text-white py-2 rounded-full disabled:opacity-50"
      >
        {isSubmitting ? "投稿中..." : "投稿する"}
      </button>

      {/* 下に例文（空状態で迷わない） */}
      <div className="mt-4 bg-green-50 rounded-xl p-3 text-sm text-gray-700">
        <div className="font-semibold mb-1">例：</div>
        <ul className="list-disc pl-5 space-y-1">
          <li>今日ちょっと頑張った</li>
          <li>副業の作業が少し進んだ</li>
          <li>早起きできた、えらい</li>
        </ul>
      </div>
    </div>
  );
}