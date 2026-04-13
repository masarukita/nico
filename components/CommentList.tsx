// components/CommentList.tsx
"use client";

import type { Comment } from "@/types/comment";
import { shortenId } from "@/utils/anonUser";

type Props = {
  comments: Comment[];
};

export default function CommentList({ comments }: Props) {
  return (
    <div className="mt-4">
      <div className="text-sm font-semibold mb-2">コメント</div>

      {comments.length === 0 && (
        <div className="text-sm text-gray-400">まだコメントがありません</div>
      )}

      <div className="space-y-2">
        {comments.map((c) => (
          <div key={c.id} className="border-b py-2">
            <div className="text-xs text-gray-500">
              匿名ユーザー ({shortenId(c.userId)})
            </div>
            <div className="text-sm whitespace-pre-wrap">{c.content}</div>
          </div>
        ))}
      </div>
    </div>
  );
}