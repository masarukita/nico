// components/Header.tsx
"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useAnonUserId } from "@/hooks/useAnonUserId";

function shortId(id: string) {
  const s = String(id ?? "");
  if (!s) return "";
  if (s.length <= 10) return s;
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

export default function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const { anonUserId } = useAnonUserId();

  const isDetail = pathname.startsWith("/post/") && !pathname.startsWith("/post/new");

  return (
    <header className="sticky top-0 z-50 bg-white/95 backdrop-blur border-b border-gray-200">
      <div className="max-w-md mx-auto px-3 py-2">
        <div className="flex items-start justify-between">
          {/* Left: 戻る or ロゴ+ID */}
          <div className="flex items-start gap-2">
            {isDetail ? (
              <button
                onClick={() => router.back()}
                className="mt-1 p-2 -ml-2 rounded-full hover:bg-gray-100 active:bg-gray-200"
                aria-label="Back"
                type="button"
              >
                <span className="text-lg leading-none">←</span>
              </button>
            ) : null}

            <div className="flex flex-col">
              <Link href="/" className="inline-flex items-center">
                <Image
                  src="/logo_full.png"
                  alt="nico"
                  width={120}
                  height={32}
                  priority
                />
              </Link>

              {/* ID 表示（添付の仕様に合わせる） */}
              <div className="text-[13px] leading-4 text-gray-500 mt-1">
                ID: {anonUserId ? shortId(anonUserId) : "…"}
              </div>
            </div>
          </div>

          {/* Right: POST ボタン（nicoロゴに合わせた緑・存在感強め） */}
          {!pathname.startsWith("/post/new") && (
            <Link
              href="/post/new"
              className="mt-1 inline-flex items-center justify-center rounded-full px-5 py-2
                         bg-[#6FCF97] text-white font-semibold text-[14px]
                         hover:opacity-95 active:opacity-90 shadow-sm"
            >
              POST
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}