// app/api/judge-comment/route.ts
import { NextResponse } from "next/server";
import { containsNg } from "@/utils/ngFilter";

/**
 * Node.js runtimeで動かす（envやfetchが安定）
 */
export const runtime = "nodejs";

/**
 * コメント本文の制約（MVP仕様）
 */
const MIN_LEN = 1;
const MAX_LEN = 100;

/**
 * 投稿本文（文脈）の上限：長すぎるとトークンの無駄なので切る
 */
const POST_CONTEXT_MAX = 280;

/**
 * OpenAI API のリトライ設定（レート制限対策）
 */
const MAX_RETRIES = 3;         // 429(rate_limit) のときだけ最大3回
const BASE_DELAY_MS = 600;     // 0.6s, 1.2s, 2.4s...

/**
 * sleep（待機）
 */
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 429が「残高不足系」か「レート制限系」かざっくり判定
 * - OpenAIのエラーボディは JSON 文字列のことが多いので文字列で判定
 */
function classify429(text: string) {
  const t = text.toLowerCase();

  const isQuota =
    t.includes("insufficient_quota") ||
    t.includes("check your plan") ||
    t.includes("billing") ||
    t.includes("exceeded your current quota");

  const isRate =
    t.includes("rate limit") ||
    t.includes("rate_limit") ||
    t.includes("too many requests") ||
    t.includes("requests per min") ||
    t.includes("tokens per min");

  if (isQuota) return "insufficient_quota";
  if (isRate) return "rate_limit";
  return "unknown";
}

/**
 * ✅ 判定軸（超重要）
 * - 「文章がポジティブか」ではなく「投稿者に寄り添っているか」
 * - 日本語/英語どちらの入力でも判定できるように明示
 * - 出力は YES/NO のみ（1語）
 */
const SYSTEM_PROMPT = `
You moderate replies in a support-only social app. Inputs may be Japanese or English.

Given a POST and a COMMENT, output ONLY "YES" or "NO".

Definition of YES:
- The COMMENT must be supportive toward the poster (empathy/validation/praise/encouragement/agreement)
AND must be consistent with the POST's intent/tone.

Important consistency rule:
- If the POST is an achievement / positive update (e.g., celebrating effort, success, progress),
  then negative reactions like "嫌だ", "最悪", "that sucks", or sarcasm are NOT supportive -> NO.
- Negative words are allowed ONLY when they empathize with a negative/complaint POST
  (e.g., "それは嫌だよね" to a complaint), and they side with the poster.

Always NO if it includes: insults/harassment, hate, threats, sexual content, doxxing,
advice/instructions ("you should", "〜した方がいい", "〜すべき"),
correction/argument ("you're wrong", "でも違う", "間違い"),
sarcasm/ridicule, or off-topic/neutral.
`.trim();

/**
 * ✅ few-shot（最小2例）
 * - あなたが通したい「嫌だよね」共感を YES 側に寄せるため、日本語例を入れる
 */
const FEWSHOT = [
  // ✅ ネガ投稿（愚痴/不快）に対する共感は YES
  {
    role: "user",
    content: "POST: 同僚が上司に分かりやすく媚びてる。\nCOMMENT: 嫌だよねそういうの。わかる。",
  },
  { role: "assistant", content: "YES" },

  // ❌ ポジ投稿（達成/努力）に対して「嫌だよね」は水差し -> NO
  {
    role: "user",
    content: "POST: 今日mtg10件もやった！\nCOMMENT: 嫌だよねそういうの。",
  },
  { role: "assistant", content: "NO" },

  // ❌ 助言/指示は NO（あなたの仕様）
  {
    role: "user",
    content: "POST: 同僚が上司に分かりやすく媚びてる。\nCOMMENT: 上司に言った方がいいよ。気にしすぎ。",
  },
  { role: "assistant", content: "NO" },
] as const;

/**
 * ✅ 任意：超安全な共感定型はAIを呼ばずYES（トークン節約 & ぶれ減少）
 * - ルール：共感ワードが入っていて、助言・反論っぽい語が無いなら YES
 * - これは“厳密なAI”ではなく“支援用のショートカット”なので、MVPには相性良い
 */
function isEasyYes(comment: string): boolean {
  const t = comment.replace(/\s+/g, "");

  // 共感/称賛の強いサイン（短いほど誤判定しにくい）
  const hasYesCue =
    /(わかる|同感|それな|わかりみ|わかります|えらい|すごい|いいね|最高)/.test(t);

  // 助言/反論/矯正（あなたのSNSでは禁止）
  const hasNoCue =
    /(した方がいい|すべき|言った方がいい|でも|違う|間違い|気にしすぎ|普通は)/.test(t);

  return hasYesCue && !hasNoCue;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    // コメント本文
    const comment = String(body?.content ?? "").trim();

    // 投稿本文（文脈：任意だが精度目的で渡すのがベター）
    const postContent = String(body?.postContent ?? "")
      .trim()
      .slice(0, POST_CONTEXT_MAX);

    // 1) 文字数チェック
    if (comment.length < MIN_LEN) {
      return NextResponse.json({ ok: false, reason: "too_short" }, { status: 200 });
    }
    if (comment.length > MAX_LEN) {
      return NextResponse.json({ ok: false, reason: "too_long" }, { status: 200 });
    }

    // 2) NGフィルタ（強い禁止のみ）
    if (containsNg(comment)) {
      return NextResponse.json({ ok: false, reason: "ng_filter_strict" }, { status: 200 });
    }

    // 2.5) ✅ 超安全な共感定型はAIを呼ばず YES（コスト最小化）
    //      ※不要ならこのブロックを丸ごと削除してもOK
    if (isEasyYes(comment)) {
      return NextResponse.json({ ok: true, reason: "rule_easy_yes" }, { status: 200 });
    }

    // 3) APIキー確認
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ ok: false, reason: "missing_api_key" }, { status: 200 });
    }

    // モデル（環境変数があればそれを使う）
    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

    // 4) OpenAI呼び出し（429 rate_limit の場合のみ指数バックオフでリトライ）
    let lastErrorText = "";

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const userMessage = `POST: ${postContent}\nCOMMENT: ${comment}`;

      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            ...FEWSHOT,
            { role: "user", content: userMessage },
          ],
        }),
      });

      // 成功 → YES/NO 判定
      if (res.ok) {
        const json = await res.json();

        // 出力はYES/NOのみが期待
        const raw = String(json?.choices?.[0]?.message?.content ?? "")
          .trim()
          .toUpperCase();

        // "YES." や改行などが混ざっても拾えるよう正規化
        const normalized = raw.replace(/[^A-Z]/g, "");
        const ok = normalized === "YES";

        return NextResponse.json({ ok, reason: ok ? "yes" : "no", raw }, { status: 200 });
      }

      // 失敗（401/429など）
      const text = await res.text().catch(() => "");
      lastErrorText = text.slice(0, 400);

      // 429は中身を判定
      if (res.status === 429) {
        const kind = classify429(text);

        // 残高不足系は待っても治らないので即終了
        if (kind === "insufficient_quota") {
          return NextResponse.json(
            { ok: false, reason: "openai_429_insufficient_quota", detail: lastErrorText },
            { status: 200 }
          );
        }

        // レート制限系ならバックオフしてリトライ
        if (kind === "rate_limit" && attempt < MAX_RETRIES) {
          const delay = BASE_DELAY_MS * Math.pow(2, attempt);
          await sleep(delay);
          continue;
        }

        // unknown なら一旦終了
        return NextResponse.json(
          { ok: false, reason: `openai_429_${kind}`, detail: lastErrorText },
          { status: 200 }
        );
      }

      // 401などは即終了
      return NextResponse.json(
        { ok: false, reason: `openai_error_${res.status}`, detail: lastErrorText },
        { status: 200 }
      );
    }

    // ここに来たらリトライしきって失敗
    return NextResponse.json(
      { ok: false, reason: "openai_failed_after_retries", detail: lastErrorText },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, reason: "exception", detail: String(e?.message ?? e) },
      { status: 200 }
    );
  }
}