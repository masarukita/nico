// lib/moderation/ngWords.ts

export type NgHit = {
  matched: string[];
  category: string;
};

// 例：あなたのルールに合わせて増やす
const NG_RULES: { category: string; words: string[] }[] = [
  // 暴言/罵倒など
  { category: "PROFANITY", words: ["死ね", "消えろ", "きもい", "うざい"] },

  // 個人情報っぽい（簡易例）
  { category: "PII", words: ["住所", "電話番号", "氏名"] },

  // 関係推測（必要なら）
  // ここをONにすると「旦那さん」などで ng_word 側が先に弾けます
  // { category: "RELATIONSHIP_GUESS", words: ["旦那", "夫", "彼氏", "彼女", "嫁"] },
];

export function checkNgWords(text: string): NgHit | null {
  const t = (text ?? "").trim();
  if (!t) return null;

  for (const rule of NG_RULES) {
    const hits = rule.words.filter((w) => t.includes(w));
    if (hits.length > 0) {
      return { matched: hits, category: rule.category };
    }
  }
  return null;
}