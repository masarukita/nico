// components/CommentInput.tsx
"use client";

import { useState } from "react";
import {
  collection,
  doc,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";

import { getDb } from "@/lib/firebase/firestore";
import { useAnonUserId } from "@/hooks/useAnonUserId";
import { containsNg } from "@/utils/ngFilter";

/**
 * コメントの仕様（MVP固定）
 */
const MIN_LEN = 1;
const MAX_LEN = 100;

/**
 * 投稿本文（文脈としてAIに渡す）の上限
 * - 長すぎるとトークンの無駄なので切る
 */
const POST_CONTEXT_MAX = 280;

/**
 * レート制限（MVP固定）
 * - 「30秒に1回」
 */
const RATE_MS = 30_000;

/**
 * localStorage のレート制限キー
 * - post単位で制限したいので postId を含める
 */
function rateKey(postId: string) {
  return `lastCommentTimestamp_${postId}`;
}

/**
 * props
 * - postId: 対象投稿ID
 * - postContent: 投稿本文（AI判定の文脈として渡す：任意だが推奨）
 * - onSubmitted: 送信成功後に親が再取得するためのコールバック
 */
type Props = {
  postId: string;
  postContent?: string; // ★追加：文脈用（省略可）
  onSubmitted?: () => void;
};

/**
 * CommentInput（完全版）
 *
 * 送信フロー：
 * 1) 匿名ID確認
 * 2) クライアント側バリデーション（文字数・NGワード）
 * 3) レート制限（localStorage）
 * 4) サーバーAPIでAI判定（/api/judge-comment）※投稿本文も一緒に渡す
 * 5) OKなら Firestore transactionで
 *    - comments に追加
 *    - posts.commentCount を +1
 */
export default function CommentInput({ postId, postContent, onSubmitted }: Props) {
  // Firestoreインスタンス
  const db = getDb();

  // 匿名ID（ユーザー識別）
  const { anonUserId } = useAnonUserId();

  // 入力文字列
  const [text, setText] = useState("");

  // 二重送信防止
  const [busy, setBusy] = useState(false);

  // UIに表示するエラー
  const [error, setError] = useState("");

  // デバッグ情報（開発用）
  const [debug, setDebug] = useState<string>("");

  /**
   * 入力バリデーション（クライアント側）
   * - サーバー側でも必ずチェックするが、UXのため先に弾く
   */
  function validate(input: string): string | null {
    const t = input.trim();

    if (t.length < MIN_LEN) return "コメントを入力してください";
    if (t.length > MAX_LEN) return `コメントは${MAX_LEN}文字以内です`;

    // AI判定の前に、明らかに危険なワードだけ弾く（ngFilter側で「強い禁止」だけに調整済み想定）
    if (containsNg(t)) return "このSNSでは共感・賞賛コメントのみ投稿できます";

    return null; // OK
  }

  /**
   * レート制限チェック（30秒）
   */
  function checkRateLimit(): string | null {
    const key = rateKey(postId);
    const last = localStorage.getItem(key);

    // 初回なら制限なし
    if (!last) return null;

    const diff = Date.now() - Number(last);
    if (diff < RATE_MS) {
      const remain = Math.ceil((RATE_MS - diff) / 1000);
      return `コメントは30秒に1回までです（あと${remain}秒）`;
    }

    return null;
  }

  /**
   * AI判定APIを呼び出す
   * - /api/judge-comment は Next.js Route Handler（サーバー側）
   * - ブラウザに OpenAIキーは出さない（重要）
   * - ★投稿本文(postContent)も送る：文脈判定で精度UP
   */
  async function judgeByAI(params: {
    comment: string;
    postContent?: string;
  }): Promise<{
    ok: boolean;
    reason?: string;
    detail?: string;
    raw?: string;
  }> {
    // 投稿本文は「文脈として十分な長さ」に切り詰める（トークン節約）
    const trimmedPost =
      (params.postContent ?? "").trim().slice(0, POST_CONTEXT_MAX);

    // fetchでAPI呼び出し
    const res = await fetch("/api/judge-comment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // ★ comment + postContent をセットで送る
      body: JSON.stringify({
        content: params.comment,
        postContent: trimmedPost,
      }),
    });

    // 200でもok:falseを返す設計なので、とりあえずJSONを読む
    const json = await res.json().catch(() => ({}));

    return json;
  }

  /**
   * Firestoreにコメント保存（transaction）
   * - comments追加と posts.commentCount++ を同時にやって整合性を保つ
   */
  async function saveCommentToFirestore(content: string) {
    const postRef = doc(db, "posts", postId);
    const commentsCol = collection(db, "comments");

    await runTransaction(db, async (tx) => {
      // 投稿が存在するか確認（存在しないpostIdならここで止める）
      const postSnap = await tx.get(postRef);
      if (!postSnap.exists()) throw new Error("投稿が存在しません");

      const postData = postSnap.data() as any;
      const curCount = Number(postData.commentCount ?? 0);

      // comments は addDoc() を transaction内で直接使えないため、
      // doc(commentsCol) で新しいIDを作って tx.set() する
      const newCommentRef = doc(commentsCol);

      // コメント作成
      tx.set(newCommentRef, {
        postId,
        userId: anonUserId, // 匿名IDを保存（後で表示するため）
        content,
        createdAt: serverTimestamp(),
      });

      // 投稿側のコメント数を +1
      tx.update(postRef, { commentCount: curCount + 1 });
    });
  }

  /**
   * 送信処理（メイン）
   */
  async function submit() {
    setError("");
    setDebug("");

    // 送信中は何もしない（二重送信防止）
    if (busy) return;

    // 匿名IDがまだ準備できていない場合
    if (!anonUserId) {
      setError("ユーザーID準備中です。少し待ってください");
      return;
    }

    // 1) 入力チェック
    const v = validate(text);
    if (v) {
      setError(v);
      return;
    }

    // 2) レート制限
    const r = checkRateLimit();
    if (r) {
      setError(r);
      return;
    }

    // 3) AI判定 → OKなら保存
    try {
      setBusy(true);

      const comment = text.trim();

      // ---- AI判定（サーバー側） ----
      const judge = await judgeByAI({
        comment,
        postContent, // ★親からもらった投稿本文を渡す（文脈）
      });

      // デバッグ表示（開発中のみ見えるようにする）
      if (judge?.reason) {
        setDebug(
          `debug: reason=${judge.reason}${judge.raw ? ` raw=${judge.raw}` : ""}`
        );
      }

      // NGなら弾く（UIに表示）
      if (!judge?.ok) {
        setError("このSNSでは共感・賞賛コメントのみ投稿できます");
        return;
      }

      // ---- Firestore保存（transaction）----
      await saveCommentToFirestore(comment);

      // 成功時：レート制限用に時刻保存
      localStorage.setItem(rateKey(postId), String(Date.now()));

      // 入力クリア
      setText("");

      // 親に再取得させる（コメント一覧/投稿のcommentCount更新）
      onSubmitted?.();
    } catch (e: any) {
      setError(`コメント送信に失敗しました: ${e?.message || String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3">
      {/* ルール表示（UX的に重要：最初に明示する） */}
      <div className="text-xs text-gray-500 mb-2">
        ※共感・賞賛コメントのみ投稿できます（否定・アドバイスは不可）
      </div>

      {/* 入力＋送信 */}
      <div className="flex gap-2">
        <input
          className="flex-1 border rounded-full px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#6FCF97]"
          placeholder="やさしいコメントを書いてね"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={MAX_LEN}
          disabled={busy}
        />

        <button
          onClick={submit}
          disabled={busy}
          className="bg-[#6FCF97] text-white px-4 rounded-full disabled:opacity-50"
        >
          {busy ? "送信中..." : "送信"}
        </button>
      </div>

      {/* エラー表示 */}
      {error && (
        <div className="mt-2 bg-red-100 text-red-700 p-2 rounded-lg text-sm">
          {error}
        </div>
      )}

     {/* デバッグ表示は開発時だけ（Vercel本番では非表示） */}
    {process.env.NODE_ENV !== "production" && debug && (
        <div className="mt-2 text-xs text-gray-400 break-words">
            {debug}
        </div>
    )}

      {/* 文字数表示（地味に便利） */}
      <div className="mt-1 text-xs text-gray-400 text-right">
        {text.trim().length}/{MAX_LEN}
      </div>
    </div>
  );
}