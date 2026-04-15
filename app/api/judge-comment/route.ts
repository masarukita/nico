// app/api/judge-comment/route.ts
import { NextResponse } from "next/server";
import { getAdminDb, admin } from "@/lib/firebase/admin";
import { checkNgWords } from "@/lib/moderation/ngWords";

type AiJudgeResult = {
  raw: "YES" | "NO";
  reason: string;
  model: string;
  latencyMs: number;
};

// --- ユーティリティ ---
function excerpt(text: string, max = 80) {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max) + "…" : t;
}

async function writeModerationLog(payload: any) {
  const db = getAdminDb();
  await db.collection("moderation_logs").add({
    ...payload,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

// --- AI判定（サーバー側） ---
async function judgeByAI(post: string, comment: string): Promise<AiJudgeResult> {
  const started = Date.now();

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY missing");

  // ※ここはあなたの既存プロンプトに合わせてOK
  const system = `You moderate replies in a support-only social app.
Output ONLY "YES" or "NO".`;

  const user = `POST: ${post}\nCOMMENT: ${comment}`;

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

  // reasonはあなたの体系に合わせてOK（例：プロンプトで理由も返すならそれを入れる）
  const reason = raw === "YES" ? "yes" : "no";
  const latencyMs = Date.now() - started;

  return { raw, reason, model, latencyMs };
}

export async function POST(req: Request) {
  const started = Date.now();

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, reason: "bad_json" }, { status: 400 });
  }

  // ✅ CommentInput.tsx（新）に合わせた受け取り
  const postId = String(body?.postId ?? "");
  const postContent = String(body?.postContent ?? "");
  const comment = String(body?.comment ?? "");
  const userId = String(body?.userId ?? "");

  // 入力チェック
  if (!postId || !comment) {
    return NextResponse.json(
      { ok: false, blockedBy: "system", reasonCode: "SYS:MISSING_INPUT" },
      { status: 400 }
    );
  }

  // ① NGワード層
  const ng = checkNgWords(comment);
  if (ng) {
    const log = {
      env: process.env.VERCEL_ENV || "prod",
      postId,
      postExcerpt: excerpt(postContent),
      commentExcerpt: excerpt(comment),
      userId,

      accepted: false,
      blockedBy: "ng_word",
      reasonCode: `NGWORD:${ng.category}`,
      ngMatched: ng.matched,

      aiRaw: null,
      aiModel: null,
      aiReason: null,
      latencyMs: Date.now() - started,
    };

    await writeModerationLog(log);

    return NextResponse.json({
      ok: false,
      blockedBy: "ng_word",
      reasonCode: log.reasonCode,
      ngMatched: ng.matched,
    });
  }

  // ② AI層
  try {
    const ai = await judgeByAI(postContent, comment);

    const accepted = ai.raw === "YES";
    const reasonCode = accepted ? "AI:YES" : `AI:NO_${ai.reason.toUpperCase()}`;

    const log = {
      env: process.env.VERCEL_ENV || "prod",
      postId,
      postExcerpt: excerpt(postContent),
      commentExcerpt: excerpt(comment),
      userId,

      accepted,
      blockedBy: accepted ? null : "ai",
      reasonCode,
      ngMatched: [],

      aiRaw: ai.raw,
      aiModel: ai.model,
      aiReason: ai.reason,
      latencyMs: ai.latencyMs,
    };

    await writeModerationLog(log);

    return NextResponse.json({
      ok: accepted,
      blockedBy: accepted ? null : "ai",
      reasonCode,
    });
  } catch (e: any) {
    // ③ システム層（OpenAI失敗等）
    const log = {
      env: process.env.VERCEL_ENV || "prod",
      postId,
      postExcerpt: excerpt(postContent),
      commentExcerpt: excerpt(comment),
      userId,

      accepted: false,
      blockedBy: "system",
      reasonCode: "SYS:AI_ERROR",
      ngMatched: [],

      aiRaw: "ERROR",
      aiModel: process.env.OPENAI_MODEL || null,
      aiReason: e?.message || String(e),
      latencyMs: Date.now() - started,
    };

    await writeModerationLog(log);

    return NextResponse.json({
      ok: false,
      blockedBy: "system",
      reasonCode: log.reasonCode,
      detail: "temporarily unavailable",
    });
  }
}