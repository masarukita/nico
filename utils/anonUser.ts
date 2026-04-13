// utils/anonUser.ts

// localStorage に保存するキー名（固定）
export const ANON_USER_ID_KEY = "anonUserId";

/**
 * 文字列を短く表示したい時に使う（画面表示用）
 * 例: 9f2a...c81d のように短縮
 */
export function shortenId(id: string, head = 4, tail = 4): string {
  if (!id) return "";
  if (id.length <= head + tail) return id;
  return `${id.slice(0, head)}...${id.slice(-tail)}`;
}

/**
 * ブラウザ環境かどうか判定（SSR対策）
 * Next.jsはサーバー側でも実行されるため、window が無い場合がある
 */
export function isBrowser(): boolean {
  return typeof window !== "undefined";
}

/**
 * 匿名ユーザーIDを取得する
 * - 既に localStorage にあればそれを返す
 * - 無ければ UUID を生成して保存して返す
 */
export function getOrCreateAnonUserId(): string {
  // サーバー側実行では localStorage が無いので空文字を返す（ここ重要）
  if (!isBrowser()) return "";

  // 既存ID取得
  const existing = window.localStorage.getItem(ANON_USER_ID_KEY);
  if (existing) return existing;

  // 無ければ新規作成（crypto.randomUUID が使える環境前提）
  const newId = window.crypto.randomUUID();

  // localStorage に保存（次回以降同じIDになる）
  window.localStorage.setItem(ANON_USER_ID_KEY, newId);

  return newId;
}