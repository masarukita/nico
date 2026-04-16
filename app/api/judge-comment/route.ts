import { NextResponse } from "next/server";
import { getAdminDb, admin } from "@/lib/firebase/admin";
import { checkNgWords } from "@/lib/moderation/ngWords";

// topic推定関数（applyと同じもの）
function inferTopic(text: string): "HEALTH" | "WORK" | "MEETING" | "RELATIONSHIP" | "STUDY" | "ANY" {
  const t = (text ?? "").toLowerCase();
  const has = (...words: string[]) => words.some(w => t.includes(w));
  if (has("おなか", "痛い", "体調", "熱", "頭痛", "しんどい", "眠い", "病院")) return "HEALTH";
  if (has("mtg", "会議", "打ち合わせ", "定例", "レビュー", "議事録")) return "MEETING";
  if (has("仕事", "業務", "顧客", "対応", "依頼", "締切", "提出", "残業")) return "WORK";
  if (has("旦那", "夫", "妻", "彼氏", "彼女", "パートナー", "家族")) return "RELATIONSHIP";
  if (has("課題", "レポート", "ゼミ", "研究", "テスト", "勉強")) return "STUDY";
  return "ANY";
}

async function fetchExamples(topic: string, db: any) {
  // allow例2件、deny例2件、ANYで補完
  const allowSnap = await db.collection("moderation_examples")
    .where("topic", "==", topic)
    .where("decision", "==", "allow")
    .orderBy("decidedAt", "desc")
    .limit(2)
    .get();

  const denySnap = await db.collection("moderation_examples")
    .where("topic", "==", topic)
    .where("decision", "==", "deny")
    .orderBy("decidedAt", "desc")
    .limit(2)
    .get();

  // ANYで補完（足りない場合）
  const allowAnySnap = await db.collection("moderation_examples")
    .where("topic", "==", "ANY")
    .where("decision", "==", "allow")
    .orderBy("decidedAt", "desc")
    .limit(2)
    .get();

  const denyAnySnap = await db.collection("moderation_examples")
    .where("topic", "==", "ANY")
    .where("decision", "==", "deny")
    .orderBy("decidedAt", "desc")
    .limit(2)
    .get();

  const examples = [
    ...allowSnap.docs,
    ...denySnap.docs,
    ...allowAnySnap.docs,
    ...denyAnySnap.docs
  ].slice(0, 4); // 最大4件

  return examples.map(d => d.data());
}

async function judgeByAI(post: string, comment: string, examples: any[]): Promise<{ raw: "YES" | "NO"; reason: string; model: string; latencyMs: number }> {
  const started = Date.now();

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY missing");

  // examplesをプロンプトに混ぜる
  const exampleText = examples.map(e =>
    `POST: ${e.postExcerpt}\nCOMMENT: ${e.comment}\nHUMAN_DECISION: ${e.decision.toUpperCase()}`
  ).join("\n\n");

  const system = `
You moderate replies in a support-only social app.
Follow these HUMAN_DECISION examples when similar.
Output ONLY "YES" or "NO".
`;

  const user = `
HUMAN_GUIDANCE_EXAMPLES:
${exampleText}

TARGET:
POST: ${post}
COMMENT: ${comment}
`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI error: ${res.status} ${text}`);
  }

  const json = await res.json();
  const content = String(json?.choices?.[0]?.message?.content ?? "")
    .trim()
    .toUpperCase();

  const raw: "YES" | "NO" = content.includes("YES") ? "YES" : "NO";
  const reason = raw === "YES" ? "yes" : "no";
  const latencyMs = Date.now() - started;

  return { raw, reason, model, latencyMs };
}

export async function POST(req: Request) {
  const db = getAdminDb();

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, reason: "bad_json" }, { status: 400 });
  }

  const postId = String(body?.postId ?? "");
  const postContent = String(body?.postContent ?? "");
  const comment = String(body?.comment ?? "");
  const userId = String(body?.userId ?? "");

  if (!postId || !comment) {
    return NextResponse.json({ ok: false, blockedBy: "system", reasonCode: "SYS:MISSING_INPUT" }, { status: 400 });
  }

  // NGワード層
  const ng = checkNgWords(comment);
  if (ng) {
    return NextResponse.json({
      ok: false,
      blockedBy: "ng_word",
      reasonCode: `NGWORD:${ng.category}`,
      ngMatched: ng.matched,
    });
  }

  // topic推定
  const topic = inferTopic(postContent);

  // examples取得
  const examples = await fetchExamples(topic, db);

  // AI判定（examplesをプロンプトに混ぜる）
  try {
    const ai = await judgeByAI(postContent, comment, examples);

    const accepted = ai.raw === "YES";
    const reasonCode = accepted ? "AI:YES" : `AI:NO_${ai.reason.toUpperCase()}`;

    return NextResponse.json({
      ok: accepted,
      blockedBy: accepted ? null : "ai",
      reasonCode,
    });
  } catch (e: any) {
    return NextResponse.json({
      ok: false,
      blockedBy: "system",
      reasonCode: "SYS:AI_ERROR",
      detail: "temporarily unavailable",
    });
  }
}