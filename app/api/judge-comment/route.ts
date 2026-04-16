// app/api/judge-comment/route.ts
import { NextResponse } from "next/server";
import { getAdminDb, admin } from "@/lib/firebase/admin";
import { checkNgWords } from "@/lib/moderation/ngWords";

type Topic = "HEALTH" | "WORK" | "MEETING" | "RELATIONSHIP" | "STUDY" | "ANY";
type AiRaw = "YES" | "NO" | "ERROR";

type AiJudgeResult = {
  raw: "YES" | "NO";
  reason: string;
  model: string;
  latencyMs: number;
};

// -------------------------
// utils
// -------------------------
function excerpt(text: string, max = 80) {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max) + "…" : t;
}

function sanitizeErrorMessage(msg: string) {
  // 万が一、キー断片が混じってもログに残さない
  return String(msg ?? "").replace(/sk-[A-Za-z0-9_-]+/g, "sk-***");
}

// topic推定（seedTopicがなくても本文から分類）
function inferTopic(text: string): Topic {
  const t = (text ?? "").toLowerCase();
  const has = (...words: string[]) => words.some((w) => t.includes(w));

  if (has("おなか", "痛い", "体調", "熱", "頭痛", "しんどい", "眠い", "病院")) return "HEALTH";
  if (has("mtg", "会議", "打ち合わせ", "定例", "レビュー", "議事録")) return "MEETING";
  if (has("仕事", "業務", "顧客", "対応", "依頼", "締切", "提出", "残業")) return "WORK";
  if (has("旦那", "夫", "妻", "彼氏", "彼女", "パートナー", "家族")) return "RELATIONSHIP";
  if (has("課題", "レポート", "ゼミ", "研究", "テスト", "勉強")) return "STUDY";

  return "ANY";
}

// moderation_logs 書き込み（必ず残す）
async function writeModerationLog(db: FirebaseFirestore.Firestore, payload: any) {
  const ref = await db.collection("moderation_logs").add({
    ...payload,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return ref.id;
}

// examples取得（topic別→足りなければANYで補完）
async function fetchExamples(db: FirebaseFirestore.Firestore, topic: Topic) {
  // NOTE:
  // ここは where(topic==) + where(decision==) + orderBy(decidedAt) を使うため、
  // Firestoreの複合インデックスが必要になる可能性があります。
  // 不足していた場合でも、このrouteはcatchで必ずmessageを返します（Responseが空にならない）。
  const col = db.collection("moderation_examples");

  const qAllowTopic = col
    .where("topic", "==", topic)
    .where("decision", "==", "allow")
    .orderBy("decidedAt", "desc")
    .limit(2);

  const qDenyTopic = col
    .where("topic", "==", topic)
    .where("decision", "==", "deny")
    .orderBy("decidedAt", "desc")
    .limit(2);

  const qAllowAny = col
    .where("topic", "==", "ANY")
    .where("decision", "==", "allow")
    .orderBy("decidedAt", "desc")
    .limit(2);

  const qDenyAny = col
    .where("topic", "==", "ANY")
    .where("decision", "==", "deny")
    .orderBy("decidedAt", "desc")
    .limit(2);

  const [allowTopicSnap, denyTopicSnap, allowAnySnap, denyAnySnap] = await Promise.all([
    qAllowTopic.get(),
    qDenyTopic.get(),
    qAllowAny.get(),
    qDenyAny.get(),
  ]);

  const docs = [
    ...allowTopicSnap.docs,
    ...denyTopicSnap.docs,
    ...allowAnySnap.docs,
    ...denyAnySnap.docs,
  ].slice(0, 4);

  return docs.map((d) => d.data());
}

// AI判定（examplesをfew-shotとして混ぜる）
async function judgeByAI(post: string, comment: string, examples: any[]): Promise<AiJudgeResult> {
  const started = Date.now();

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY missing");

  const exampleText =
    examples && examples.length
      ? examples
          .map(
            (e) =>
              `POST: ${String(e.postExcerpt ?? "")}\nCOMMENT: ${String(e.comment ?? "")}\nHUMAN_DECISION: ${String(
                e.decision ?? ""
              ).toUpperCase()}`
          )
          .join("\n\n")
      : "(no examples yet)";

  const system = `You moderate replies in a support-only social app.
Rules:
- This is a positive-only SNS: allow only empathy/support/praise that matches the post context.
- If uncertain, prefer NO (will go to human review).
Follow HUMAN_DECISION examples when similar.
Output ONLY "YES" or "NO".`;

  const user = `HUMAN_GUIDANCE_EXAMPLES:
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
  const content = String(json?.choices?.[0]?.message?.content ?? "").trim().toUpperCase();

  const raw: "YES" | "NO" = content.includes("YES") ? "YES" : "NO";
  const reason = raw === "YES" ? "yes" : "no";
  const latencyMs = Date.now() - started;

  return { raw, reason, model, latencyMs };
}

// -------------------------
// Route Handler
// -------------------------
export async function POST(req: Request) {
  const started = Date.now();
  const db = getAdminDb();

  try {
    let body: any = null;
    try {
      body = await req.json();
    } catch (e) {
      console.error("[judge-comment] bad_json", e);
      return NextResponse.json(
        { ok: false, stage: "gray", blockedBy: "system", reasonCode: "SYS:BAD_JSON" },
        { status: 400 }
      );
    }

    const postId = String(body?.postId ?? "");
    const postContent = String(body?.postContent ?? "");
    const comment = String(body?.comment ?? "");
    const userId = String(body?.userId ?? "");

    if (!postId || !comment) {
      return NextResponse.json(
        { ok: false, stage: "gray", blockedBy: "system", reasonCode: "SYS:MISSING_INPUT" },
        { status: 400 }
      );
    }

    // -------------------------
    // BLACK: 強NGワード（AIに回さない）
    // -------------------------
    const ng = checkNgWords(comment);
    if (ng) {
      const logId = await writeModerationLog(db, {
        env: process.env.VERCEL_ENV || "local",
        postId,
        postExcerpt: excerpt(postContent),
        commentExcerpt: excerpt(comment),
        userId,

        accepted: false,
        stage: "black",
        blockedBy: "ng_word",
        reasonCode: `NGWORD:${ng.category}`,
        ngMatched: ng.matched,

        aiRaw: null,
        aiModel: null,
        aiReason: null,
        latencyMs: Date.now() - started,
      });

      return NextResponse.json({
        ok: false,
        stage: "black",
        blockedBy: "ng_word",
        reasonCode: `NGWORD:${ng.category}`,
        ngMatched: ng.matched,
        logId,
      });
    }

    // -------------------------
    // WHITE/GRAY: AI（examples参照）
    // -------------------------
    const topic = inferTopic(postContent);

    // examples取得（ここでインデックス不足などが起きたらcatchへ）
    const examples = await fetchExamples(db, topic);

    const ai = await judgeByAI(postContent, comment, examples);

    // WHITE
    if (ai.raw === "YES") {
      const logId = await writeModerationLog(db, {
        env: process.env.VERCEL_ENV || "local",
        postId,
        postExcerpt: excerpt(postContent),
        commentExcerpt: excerpt(comment),
        userId,

        accepted: true,
        stage: "white",
        blockedBy: null,
        reasonCode: "AI:YES",
        ngMatched: [],

        topic,
        aiRaw: ai.raw,
        aiModel: ai.model,
        aiReason: ai.reason,
        latencyMs: ai.latencyMs,
      });

      return NextResponse.json({
        ok: true,
        stage: "white",
        blockedBy: null,
        reasonCode: "AI:YES",
        logId,
      });
    }

    // GRAY（AI: NO）→ pendingへ
    const reasonCode = `AI:NO_${ai.reason.toUpperCase()}`;
    const logId = await writeModerationLog(db, {
      env: process.env.VERCEL_ENV || "local",
      postId,
      postExcerpt: excerpt(postContent),
      commentExcerpt: excerpt(comment),
      userId,

      accepted: false,
      stage: "gray",
      blockedBy: "ai",
      reasonCode,
      ngMatched: [],

      topic,
      aiRaw: ai.raw,
      aiModel: ai.model,
      aiReason: ai.reason,
      latencyMs: ai.latencyMs,
    });

    const pendingRef = await db.collection("comments_pending").add({
      postId,
      userId,
      content: comment,
      postExcerpt: excerpt(postContent),
      commentExcerpt: excerpt(comment),

      topic,
      aiRaw: ai.raw as AiRaw,
      aiReason: ai.reason,
      aiModel: ai.model,

      status: "pending",
      decidedAt: null,
      decidedBy: null,
      appliedAt: null,
      appliedCommentId: null,

      logId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return NextResponse.json({
      ok: false,
      stage: "gray",
      blockedBy: "ai",
      reasonCode,
      pendingId: pendingRef.id,
      logId,
    });
  } catch (e: any) {
    // ★ここが重要：Responseが空にならないよう必ずJSONを返す
    const msg = sanitizeErrorMessage(e?.message || String(e));
    console.error("[judge-comment] 500 error:", e);

    // systemエラーも gray として pending に落として、人間が救済できるようにしてもOK
    // ただしここではまず原因特定優先で、bodyに message を返す
    return NextResponse.json(
      {
        ok: false,
        stage: "gray",
        blockedBy: "system",
        reasonCode: "SYS:INTERNAL",
        message: msg,
      },
      { status: 500 }
    );
  }
}
