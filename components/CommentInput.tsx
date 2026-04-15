"use client";

import { useState } from "react";

type Props = {
  postId: string;
  postContent: string;
  onSubmitted?: () => void;
};

export default function CommentInput({ postId, postContent, onSubmitted }: Props) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  // ここはあなたの anon userId 取得に合わせてください
  const userId =
    typeof window !== "undefined"
      ? localStorage.getItem("anonUserId") || ""
      : "";

  const submit = async () => {
    if (!text.trim()) return;

    try {
      setError("");
      setSending(true);

      const res = await fetch("/api/judge-comment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          postId,
          postContent,
          comment: text,
          userId,
        }),
      });

      const json = await res.json();

      if (!json.ok) {
        // UIには簡潔に（詳細はmoderation_logsに残る）
        setError("そのコメントは投稿できませんでした。");
        return;
      }

      // OKなら、あなたの既存のcreateComment等を呼ぶ構造ならここで呼ぶ
      // 例：await createComment({ postId, content: text, userId });

      setText("");
      onSubmitted?.();
    } catch (e: any) {
      setError("送信に失敗しました。時間をおいて再度お試しください。");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mt-3">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="コメントを書く（共感・応援）"
        className="w-full border rounded-lg p-2"
        maxLength={200}
      />
      <div className="flex justify-between items-center mt-2">
        <div className="text-xs text-gray-400">{text.length}/200</div>
        <button
          onClick={submit}
          disabled={sending}
          className="bg-[#6FCF97] text-white px-4 py-2 rounded-full disabled:opacity-60"
        >
          {sending ? "投稿中..." : "投稿"}
        </button>
      </div>

      {!!error && (
        <div className="mt-2 text-sm text-red-600">{error}</div>
      )}
    </div>
  );
}