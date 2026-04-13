// hooks/useAnonUserId.ts
"use client";

import { useEffect, useState } from "react";
import { getOrCreateAnonUserId, shortenId } from "@/utils/anonUser";

export function useAnonUserId() {
  // 実際のID（UUID）
  const [anonUserId, setAnonUserId] = useState<string>("");

  // 表示用の短縮ID（例: a1b2...z9y8）
  const [displayId, setDisplayId] = useState<string>("");

  useEffect(() => {
    // ブラウザ側でのみID作成/取得する
    const id = getOrCreateAnonUserId();

    // state に保存してコンポーネントから参照できるようにする
    setAnonUserId(id);
    setDisplayId(shortenId(id));
  }, []);

  return { anonUserId, displayId };
}