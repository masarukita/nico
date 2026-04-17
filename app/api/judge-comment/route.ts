// app/api/judge-comment/route.ts
import { NextResponse } from "next/server";
import { getAdminDb, admin } from "@/lib/firebase/admin";
import { checkNgWords } from "@/lib/moderation/ngWords";

type Topic = "HEALTH" | "WORK" | "MEETING" | "RELATIONSHIP" | "STUDY" | "ANY";
type Stage = "white" | "gray" | "black";

type AiOutput = {
  stage: Stage;
  reasonCode: string;
  note?: string;
};

function excerpt(text: string, max = 80) {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max) + "…" : t;
}

function sanitizeErrorMessage(msg: string) {
  return String(msg ?? "").replace(/sk-[A-Za-z0-9_-]+/g, "sk-***");
}

function normalizeKey(text: string) {
  return String(text ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function inferTopic(text: string): Topic {
  const t = (text ?? "").toLowerCase();
  const has = (...words: string[]) => words.some((w) => t.includes(w));

  // ★改善（3）：英語/海外/外国などはMEETINGとは限らないのでANY/RELATIONSHIPへ寄せ過ぎない
  // ただし「mtg/会議」があるならMEETINGを優先。
  if (has("mtg", "会議", "打ち合わせ", "定例", "レビュー", "議事録")) return "MEETING";

  if (has("おなか", "痛い", "体調", "熱", "頭痛", "しんどい", "眠い", "病院")) return "HEALTH";
  if (has("仕事", "業務", "顧客", "対応", "依頼", "締切", "提出", "残業")) return "WORK";
  if (has("旦那", "夫", "妻", "彼氏", "彼女", "パートナー", "家族")) return "RELATIONSHIP";
  if (has("課題", "レポート", "ゼミ", "研究", "テスト", "勉強")) return "STUDY";

  return "ANY";
}

function makeFingerprint(topic: Topic, postExcerpt: string, comment: string) {
  const a = normalizeKey(postExcerpt);
  const b = normalizeKey(comment);
  return `v1|${topic}|${a}|${b}`;
}

async function writeModerationLog(db: FirebaseFirestore.Firestore, payload: any) {
  const ref = await db.collection("moderation_logs").add({
    ...payload,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return ref.id;
}

// exact match（fingerprint一致）を優先
async function findExactDecision(db: FirebaseFirestore.Firestore, fp: string) {
  const docSnap = await db.collection("moderation_examples").doc(fp).get();
  if (!docSnap.exists) return null;
  const e = docSnap.data() as any;
  const decision = String(e.decision ?? "");
  if (decision === "allow" || decision === "deny") return decision as "allow" | "deny";
  return null;
}

// examples取得（インデックス地獄を避ける：最新50件だけ取ってメモリでフィルタ）
async function fetchFewShotExamples(db: FirebaseFirestore.Firestore, topic: Topic) {
  const snap = await db.collection("moderation_examples")
    .orderBy("decidedAt", "desc")
    .limit(50)
    .get();

  const rows = snap.docs.map(d => d.data() as any);

  const pick = (t: Topic, decision: "allow" | "deny", n: number) =>
    rows.filter(r => r.topic === t && r.decision === decision).slice(0, n);

  const examples = [
    ...pick(topic, "allow", 2),
    ...pick(topic, "deny", 2),
    ...pick("ANY", "allow", 1),
    ...pick("ANY", "deny", 1),
  ].slice(0, 4);

  return examples;
}

// AI判定：stage/reasonCode を JSONで返させる（1の改善：理由コード）
async function judgeByAI(post: string, comment: string, examples: any[]): Promise<{ out: AiOutput; model: string; latencyMs: number }> {
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

  const system = `You are a moderation engine for a positive-only SNS.
Return JSON only with keys: stage, reasonCode, note.
- stage must be one of: "white", "gray", "black"
- "white": empathy/support/praise that matches the post context.
- "gray": uncertain or borderline; send to human review.
- "black": clear policy violation (harassment, hate, personal attack, explicit slur, etc.)
Prefer "gray" over "white" when uncertain.

reasonCode examples (choose one that fits):
- OK_SUPPORT
- OK_EMPATHY
- OK_PRAISE
- GRAY_UNCERTAIN
- GRAY_OFFTOPIC
- GRAY_ASSUMPTION
- BLACK_HARASSMENT
- BLACK_HATE
- BLACK_ATTACK
`;

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
      response_format: { type: "json_object" } // JSON強制（対応モデルなら効く）
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI error: ${res.status} ${text}`);
  }

  const json = await res.json();
  const content = String(json?.choices?.[0]?.message?.content ?? "").trim();

  let out: AiOutput | null = null;
  try {
    out = JSON.parse(content);
  } catch {
    out = null;
  }

  // fallback（壊れてたらgray）
  const stage: Stage =
    out?.stage === "white" || out?.stage === "black" || out?.stage === "gray" ? out.stage : "gray";

  const reasonCode = String(out?.reasonCode ?? "GRAY_UNCERTAIN");
  const note = out?.note ? String(out.note) : undefined;

  const latencyMs = Date.now() - started;
  return { out: { stage, reasonCode, note }, model, latencyMs };
}

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

    // BLACK: 強NGワード
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

    const postEx = excerpt(postContent, 80);
    const topic = inferTopic(postContent);
    const fp = makeFingerprint(topic, postEx, comment);

    // ✅ 2) exact-match優先（HUMAN決定をAIより上）
    const exact = await findExactDecision(db, fp);
    if (exact === "allow") {
      const logId = await writeModerationLog(db, {
        env: process.env.VERCEL_ENV || "local",
        postId,
        postExcerpt: postEx,
        commentExcerpt: excerpt(comment),
        userId,

        accepted: true,
        stage: "white",
        blockedBy: null,
        reasonCode: "HUMAN:EXACT_ALLOW",
        topic,
        fingerprint: fp,

        aiRaw: null,
        aiModel: null,
        aiReason: null,
        latencyMs: Date.now() - started,
      });

      return NextResponse.json({
        ok: true,
        stage: "white",
        blockedBy: null,
        reasonCode: "HUMAN:EXACT_ALLOW",
        logId,
      });
    }
    if (exact === "deny") {
      const logId = await writeModerationLog(db, {
        env: process.env.VERCEL_ENV || "local",
        postId,
        postExcerpt: postEx,
        commentExcerpt: excerpt(comment),
        userId,

        accepted: false,
        stage: "black",
        blockedBy: "ai",
        reasonCode: "HUMAN:EXACT_DENY",
        topic,
        fingerprint: fp,

        aiRaw: null,
        aiModel: null,
        aiReason: null,
        latencyMs: Date.now() - started,
      });

      return NextResponse.json({
        ok: false,
        stage: "black",
        blockedBy: "ai",
        reasonCode: "HUMAN:EXACT_DENY",
        logId,
      });
    }

    // ✅ 1,3) examples参照（最新50件からtopic/decisionでフィルタ）
    const examples = await fetchFewShotExamples(db, topic);

    // AI判定（stage/reasonCode付き）
    const ai = await judgeByAI(postContent, comment, examples);

    // white → そのままOK
    if (ai.out.stage === "white") {
      const logId = await writeModerationLog(db, {
        env: process.env.VERCEL_ENV || "local",
        postId,
        postExcerpt: postEx,
        commentExcerpt: excerpt(comment),
        userId,

        accepted: true,
        stage: "white",
        blockedBy: null,
        reasonCode: `AI:${ai.out.reasonCode}`,
        topic,
        fingerprint: fp,

        aiRaw: "YES",
        aiModel: ai.model,
        aiReason: ai.out.reasonCode,
        latencyMs: ai.latencyMs,
      });

      return NextResponse.json({
        ok: true,
        stage: "white",
        blockedBy: null,
        reasonCode: `AI:${ai.out.reasonCode}`,
        logId,
      });
    }

    // black/gray → pendingへ（blackも人間救済したいならここをgrayに寄せてもOK）
    const stage: Stage = ai.out.stage === "black" ? "gray" : "gray"; // 運用簡単化：AI black もいったん gray に流す
    const blockedBy = "ai";
    const reasonCode = `AI:${ai.out.reasonCode}`;

    const logId = await writeModerationLog(db, {
      env: process.env.VERCEL_ENV || "local",
      postId,
      postExcerpt: postEx,
      commentExcerpt: excerpt(comment),
      userId,

      accepted: false,
      stage,
      blockedBy,
      reasonCode,
      topic,
      fingerprint: fp,

      aiRaw: "NO",
      aiModel: ai.model,
      aiReason: ai.out.reasonCode,
      latencyMs: ai.latencyMs,
    });

    const pendingRef = await db.collection("comments_pending").add({
      postId,
      userId,
      content: comment,
      postExcerpt: postEx,
      commentExcerpt: excerpt(comment),

      topic,
      fingerprint: fp,

      aiRaw: "NO",
      aiReason: ai.out.reasonCode,
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
      blockedBy: blockedBy,
      reasonCode,
      pendingId: pendingRef.id,
      logId,
    });
  } catch (e: any) {
    const msg = sanitizeErrorMessage(e?.message || String(e));
    console.error("[judge-comment] 500 error:", e);

    // Responseが空にならないよう必ず返す
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