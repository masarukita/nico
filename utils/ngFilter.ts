// utils/ngFilter.ts

/**
 * 目的：
 * - AI判定の前に「明らかに危険/攻撃的」なものだけを弾く（コスト削減＆安全）
 * - ただし「嫌だよね」「最悪だったね」など “共感に使われる感情語” はここでは弾かない
 *   → 文脈（post+comment）でAIに判断させるのが精度が出る
 */

/**
 * 強い禁止（即ブロック）
 * - 暴言/脅迫/自殺自傷/殺害など
 * - ここは「誤検知より安全」を優先してOK
 */
const NG_WORDS_STRICT = [
  // 自殺・自傷・殺害系
  "死ね",
  "しね",
  "殺す",
  "ころす",
  "殺して",
  "消えろ",
  "自殺",
  "くたばれ",

  // 強い罵倒（人格攻撃）
  "バカ",
  "ばか",
  "アホ",
  "あほ",
  "ゴミ",
  "カス",
  "きもい",
  "キモい",
  "うざい",
  "ウザい",

  // 外見罵倒（強め：必要なら後で調整）
  "ブス",
  "デブ",
  "ハゲ",
];

/**
 * 追加の危険パターン（簡易）
 * - 直接的な脅迫/攻撃を拾う
 * - 「嫌い」「最悪」「でも」等はここに入れない（共感で使われるため）
 */
const NG_PATTERNS_STRICT = [
  "〇ね", // マスクした死ねを拾う意図（必要なら増強）
  "○ね",
  "し●ね",
  "し○ね",
];

/**
 * 正規化：
 * - NFKCで全角半角ゆれ吸収
 * - 小文字化
 * - 空白・一部記号を除去
 */
export function normalizeForFilter(text: string): string {
  // 1) Unicode正規化（全角→半角などに寄せる）
  const nfkc = text.normalize("NFKC");

  // 2) 小文字化（英字対策）
  const lower = nfkc.toLowerCase();

  // 3) 空白・タブ・改行を除去
  const noSpace = lower.replace(/\s+/g, "");

  // 4) よく混ぜられる記号を除去（完全ではないがMVPでは十分）
  //    例：b*a*k*a や し-ね など
  const stripped = noSpace.replace(/[\.\-_,/\\|!@#$%^&*()[\]{}:;"'`~＝=＋+・]/g, "");

  return stripped;
}

/**
 * 強い禁止に該当するか（trueで即ブロック）
 */
export function containsNgStrict(text: string): boolean {
  const t = normalizeForFilter(text);

  // 単語（部分一致）
  for (const w of NG_WORDS_STRICT) {
    // w側も正規化して比較（ゆれ吸収）
    const wn = normalizeForFilter(w);
    if (wn && t.includes(wn)) return true;
  }

  // パターン（部分一致）
  for (const p of NG_PATTERNS_STRICT) {
    const pn = normalizeForFilter(p);
    if (pn && t.includes(pn)) return true;
  }

  return false;
}

/**
 * 互換用：既存コードが containsNg を import している想定なので残す
 * - 中身は「Strictのみ」に変更（=誤検知を減らす）
 */
export function containsNg(text: string): boolean {
  return containsNgStrict(text);
}