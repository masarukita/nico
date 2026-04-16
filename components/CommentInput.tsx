"use client";

import { useState } from "react";
import { collection, doc, runTransaction, serverTimestamp } from "firebase/firestore";

import { getDb } from "@/lib/firebase/firestore";
import { useAnonUserId } from "@/hooks/useAnonUserId";

const MIN_LEN = 1;
const MAX_LEN = 100;
const POST_CONTEXT_MAX = 280;
const RATE_MS = 30_000;

function rateKey(postId: string) {
  return `lastCommentTimestamp_${postId}`;
}

type Props = {
  postId: string;
  postContent?: string;
  onSubmitted?: () => void;
};

type JudgeResponse = {
  ok: boolean;
  stage?: "white" | "black" | "gray";
  blockedBy?: "ng_word" | "ai" | "system" | null;
  reasonCode?: string;
  ngMatched?: string[];
  pendingId?: string;
  logId?: string;
};

export default function CommentInput({ postId, postContent, onSubmitted }: Props) {
  const db = getDb();
  const { anonUserId } = useAnonUserId();

  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [debug, setDebug] = useState("");

  // ✅ クライアント側は「最低限」だけ。表現の是非はサーバへ（AI+ルール+ログ）
  function validateBasic(input: string): string | null {
    const t = input.trim();
    if (t.length < MIN_LEN) return "コメントを入力してください";
    if (t.length > MAX_LEN) return `コメントは${MAX_LEN}文字以内です`;
    return null;
  }

  function checkRateLimit(): string | null {
    const key = rateKey(postId);
    const last = localStorage.getItem(key);
    if (!last) return null;

    const diff = Date.now() - Number(last);
    if (diff < RATE_MS) {
      const remain = Math.ceil((RATE_MS - diff) / 1000);
      return `コメントは30秒に1回までです（あと${remain}秒）`;
    }
    return null;
  }

  async function judgeByServer(comment: string): Promise<JudgeResponse> {
    const trimmedPost = (postContent ?? "").trim().slice(0, POST_CONTEXT_MAX);

    const res = await fetch("/api/judge-comment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        postId,
        postContent: trimmedPost,
        comment,
        userId: anonUserId,
      }),
    });

    return (await res.json().catch(() => ({}))) as JudgeResponse;
  }

  async function saveCommentToFirestore(content: string) {
    const postRef = doc(db, "posts", postId);
    const commentsCol = collection(db, "comments");

    await runTransaction(db, async (tx) => {
      const postSnap = await tx.get(postRef);
      if (!postSnap.exists()) throw new Error("投稿が存在しません");

      const postData = postSnap.data() as any;
      const curCount = Number(postData.commentCount ?? 0);

      const newCommentRef = doc(commentsCol);

      tx.set(newCommentRef, {
        postId,
        userId: anonUserId,
        content,
        createdAt: serverTimestamp(),
      });

      tx.update(postRef, { commentCount: curCount + 1 });
    });
  }

  function setMessageByJudge(judge: JudgeResponse) {
    // ★ユーザーに見せる文言は「簡潔に」＋「次の行動がわかる」ようにする
    if (judge.stage === "gray") {
      setError("このコメントはAI判定で保留になりました。確認後に反映されます。");
      return;
    }
    if (judge.blockedBy === "system") {
      setError("ただいま判定が混み合っています。少し時間をおいて再度お試しください。");
      return;
    }
    // black/ng_word or ai NG の場合
    setError("このSNSでは共感・賞賛コメントのみ投稿できます");
  }

  async function submit() {
    setError("");
    setDebug("");

    if (busy) return;
    if (!postId) return setError("投稿IDが取得できません。再読み込みしてください。");
    if (!anonUserId) return setError("ユーザーID準備中です。少し待ってください。");

    const v = validateBasic(text);
    if (v) return setError(v);

    const r = checkRateLimit();
    if (r) return setError(r);

    try {
      setBusy(true);

      const comment = text.trim();

      // ① サーバ判定（ここで moderation_logs / grayなら comments_pending が作られる）
      const judge = await judgeByServer(comment);

      // devだけデバッグ表示（本番は出さない）
      if (process.env.NODE_ENV !== "production") {
        const parts: string[] = [];
        if (judge.stage) parts.push(`stage=${judge.stage}`);
        if (judge.blockedBy) parts.push(`blockedBy=${judge.blockedBy}`);
        if (judge.reasonCode) parts.push(`reasonCode=${judge.reasonCode}`);
        if (judge.pendingId) parts.push(`pendingId=${judge.pendingId}`);
        if (judge.logId) parts.push(`logId=${judge.logId}`);
        if (judge.ngMatched?.length) parts.push(`ng=${judge.ngMatched.join(",")}`);
        if (parts.length) setDebug(`debug: ${parts.join(" ")}`);
      }

      if (!judge.ok) {
        setMessageByJudge(judge);
        return;
      }

      // ② WHITE（OK）のときだけ保存
      await saveCommentToFirestore(comment);

      localStorage.setItem(rateKey(postId), String(Date.now()));
      setText("");
      onSubmitted?.();
    } catch (e: any) {
      console.error("[CommentInput] submit failed:", e);
      setError(`コメント送信に失敗しました: ${e?.message || String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3">
      <div className="text-xs text-gray-500 mb-2">
        ※共感・賞賛コメントのみ投稿できます（否定・アドバイスは不可）
      </div>

      <div className="flex gap-2">
        <input
          className="flex-1 border rounded-full px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#6FCF97]"
          placeholder="コメントを書く（共感・応援）"
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
          {busy ? "送信中..." : "投稿"}
        </button>
      </div>

      {error && (
        <div className="mt-2 bg-red-100 text-red-700 p-2 rounded-lg text-sm">
          {error}
        </div>
      )}

      {process.env.NODE_ENV !== "production" && debug && (
        <div className="mt-2 text-xs text-gray-400 break-words">{debug}</div>
      )}

      <div className="mt-1 text-xs text-gray-400 text-right">
        {text.trim().length}/{MAX_LEN}
      </div>
    </div>
  );
}