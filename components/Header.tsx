// components/Header.tsx
"use client";

import Logo from "./Logo";
import Link from "next/link";
import { useAnonUserId } from "@/hooks/useAnonUserId";

export default function Header() {
  // 匿名ID取得（初回アクセスで発行される）
  const { displayId } = useAnonUserId();

  // LINE共有用関数（ブラウザでのみ動く）
  const shareToLine = () => {
    // 現在のURLを取得
    const url = encodeURIComponent(window.location.href);

    // シェア用テキスト
    const text = encodeURIComponent('優しい SNS「nico」使ってみて！');

    // LINE共有URL（LINE公式の共有URL形式）
    const lineUrl = `https://social-plugins.line.me/lineit/share?url=${url}&text=${text}`;

    // 新しいタブで開く
    window.open(lineUrl, "_blank");
  };

  return (
    <div className="flex justify-between items-center py-3 px-4 max-w-md mx-auto">
      {/* ✅ 左側：ロゴ＋ID表示をトップページへのリンクにする */}
      <Link href="/" className="flex flex-col cursor-pointer">
        {/* ロゴ */}
        <Logo />
        {/* 匿名IDの短縮表示（動作確認用） */}
        <span className="text-xs text-gray-400 mt-1">
          ID: {displayId || "..."}
        </span>
      </Link>

      {/* 右側：ボタン群 */}
      <div className="flex gap-2">
        {/* LINE共有ボタン */}
        <button
          onClick={shareToLine}
          className="bg-green-500 text-white px-3 py-2 rounded-full text-sm"
        >
          LINE
        </button>

        {/* 投稿画面へ */}
        <Link href="/post/new">
          <button className="bg-[#6FCF97] text-white px-4 py-2 rounded-full">
            投稿
          </button>
        </Link>
      </div>
    </div>
  );
}