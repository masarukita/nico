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

function excerpt(text: string, max = 80) {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max) + "…" : t;
}

function sanitizeErrorMessage(msg: string) {
  // 念のため鍵っぽい文字列は伏せる
  return String(msg ?? "").replace(/sk-[A-Za-z0-9_-]+/g, "sk-***");
}

async function writeModerationLog(payload: any) {
  const db = getAdminDb();
  const ref = await db.collection("moderation_logs").add({
    ...payload,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return ref.id;
}

// --- AI判定 ---
async function judgeByAI(post: string, comment: string): Promise<AiJudgeResult> {
  const started = Date.now();

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY missing");

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
  const reason = raw === "YES" ? "yes" : "no";
  const latencyMs = Date.now() - started;

  return { raw, reason, model, latencyMs };
}

export async function POST(req: Request) {
  const started = Date.now();
  const db = getAdminDb();

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, blockedBy: "system", reasonCode: "SYS:BAD_JSON" }, { status: 400 });
  }

  const postId = String(body?.postId ?? "");
  const postContent = String(body?.postContent ?? "");
  const comment = String(body?.comment ?? "");
  const userId = String(body?.userId ?? "");

  if (!postId || !comment) {
    return NextResponse.json({ ok: false, blockedBy: "system", reasonCode: "SYS:MISSING_INPUT" }, { status: 400 });
  }

  // =========================
  // BLACK（強NGワード）
  // =========================
  const ng = checkNgWords(comment);
  if (ng) {
    const logId = await writeModerationLog({
      env: process.env.VERCEL_ENV || "production",
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

  // =========================
  // WHITE / GRAY（AI）
  // =========================
  try {
    const ai = await judgeByAI(postContent, comment);

    // WHITE: YES → OK
    if (ai.raw === "YES") {
      const logId = await writeModerationLog({
        env: process.env.VERCEL_ENV || "production",
        postId,
        postExcerpt: excerpt(postContent),
        commentExcerpt: excerpt(comment),
        userId,

        accepted: true,
        stage: "white",
        blockedBy: null,
        reasonCode: "AI:YES",
        ngMatched: [],

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

    // GRAY: NO → 保留
    const logId = await writeModerationLog({
      env: process.env.VERCEL_ENV || "production",
      postId,
      postExcerpt: excerpt(postContent),
      commentExcerpt: excerpt(comment),
      userId,

      accepted: false,
      stage: "gray",
      blockedBy: "ai",
      reasonCode: `AI:NO_${ai.reason.toUpperCase()}`,
      ngMatched: [],

      aiRaw: ai.raw,
      aiModel: ai.model,
      aiReason: ai.reason,
      latencyMs: ai.latencyMs,
    });

    // pendingへ登録
    const pendingRef = await db.collection("comments_pending").add({
      postId,
      userId,
      content: comment,
      postExcerpt: excerpt(postContent),
      commentExcerpt: excerpt(comment),

      aiRaw: ai.raw,
      aiReason: ai.reason,
      aiModel: ai.model,

      status: "pending", // ★人間が allow/deny に変える
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
      reasonCode: `AI:NO_${ai.reason.toUpperCase()}`,
      pendingId: pendingRef.id,
      logId,
    });
  } catch (e: any) {
    // AI失敗も GRAY 扱いにして保留へ（systemエラーでも人が通せる）
    const safeMsg = sanitizeErrorMessage(e?.message || String(e));
    const logId = await writeModerationLog({
      env: process.env.VERCEL_ENV || "production",
      postId,
      postExcerpt: excerpt(postContent),
      commentExcerpt: excerpt(comment),
      userId,

      accepted: false,
      stage: "gray",
      blockedBy: "system",
      reasonCode: "SYS:AI_ERROR",
      ngMatched: [],

      aiRaw: "ERROR",
      aiModel: process.env.OPENAI_MODEL || null,
      aiReason: safeMsg,
      latencyMs: Date.now() - started,
    });

    const pendingRef = await db.collection("comments_pending").add({
      postId,
      userId,
      content: comment,
      postExcerpt: excerpt(postContent),
      commentExcerpt: excerpt(comment),

      aiRaw: "ERROR",
      aiReason: safeMsg,
      aiModel: process.env.OPENAI_MODEL || null,

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
      blockedBy: "system",
      reasonCode: "SYS:AI_ERROR",
      pendingId: pendingRef.id,
      logId,
    });
  }
}