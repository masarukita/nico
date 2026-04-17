// app/api/moderation/apply/route.ts
import { NextResponse } from "next/server";
import { getAdminDb, admin } from "@/lib/firebase/admin";

type Topic = "HEALTH" | "WORK" | "MEETING" | "RELATIONSHIP" | "STUDY" | "ANY";

function requireAdmin(req: Request) {
  const token = process.env.MODERATION_ADMIN_TOKEN;
  if (!token) throw new Error("MODERATION_ADMIN_TOKEN missing");
  const h = req.headers.get("x-admin-token") || "";
  return h === token;
}

function excerpt(text: string, max = 80) {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max) + "…" : t;
}

// 文字揺れ吸収して fingerprint を安定させる
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
  // Firestore docIdとして安全（/ を含まない）
  return `v1|${topic}|${a}|${b}`;
}

async function upsertExampleTx(
  tx: FirebaseFirestore.Transaction,
  db: FirebaseFirestore.Firestore,
  params: {
    topic: Topic;
    postExcerpt: string;
    comment: string;
    decision: "allow" | "deny";
    source: string;
    postId?: string;
    pendingId?: string;
  }
) {
  const fp = makeFingerprint(params.topic, params.postExcerpt, params.comment);

  // ★ここが肝：docId = fingerprint に固定
  const ref = db.collection("moderation_examples").doc(fp);

  tx.set(
    ref,
    {
      fingerprint: fp,
      topic: params.topic,
      postExcerpt: params.postExcerpt,
      comment: params.comment,
      decision: params.decision,
      source: params.source,
      postId: params.postId || null,
      pendingId: params.pendingId || null,
      decidedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

export async function POST(req: Request) {
  try {
    if (!requireAdmin(req)) {
      return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
    }

    const db = getAdminDb();

    // allow / deny をそれぞれ拾う（運用簡単）
    const [allowSnap, denySnap] = await Promise.all([
      db.collection("comments_pending").where("status", "==", "allow").limit(50).get(),
      db.collection("comments_pending").where("status", "==", "deny").limit(50).get(),
    ]);

    let applied = 0;
    let denied = 0;
    const errors: any[] = [];

    // 1) allow → commentsへ反映 + examplesへ保存（docId=fingerprint）
    for (const docSnap of allowSnap.docs) {
      const p = docSnap.data() as any;

      const postId = String(p.postId ?? "");
      const userId = String(p.userId ?? "");
      const content = String(p.content ?? "");
      const postEx = excerpt(p.postExcerpt ?? "", 80);

      if (!postId || !content) {
        await docSnap.ref.update({
          status: "deny",
          decidedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        continue;
      }

      const topic: Topic = (p.topic as Topic) || inferTopic(postEx);

      const pendingRef = docSnap.ref;
      const postRef = db.collection("posts").doc(postId);

      try {
        await db.runTransaction(async (tx) => {
          const post = await tx.get(postRef);
          if (!post.exists) {
            tx.update(pendingRef, {
              status: "deny",
              decidedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            return;
          }

          const curCount = Number((post.data() as any)?.commentCount ?? 0);

          const newCommentRef = db.collection("comments").doc();
          tx.set(newCommentRef, {
            postId,
            userId,
            content,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });

          tx.update(postRef, { commentCount: curCount + 1 });

          tx.update(pendingRef, {
            status: "applied",
            appliedAt: admin.firestore.FieldValue.serverTimestamp(),
            appliedCommentId: newCommentRef.id,
          });

          // ★allow例を保存（docId = fingerprint）
          await upsertExampleTx(tx, db, {
            topic,
            postExcerpt: postEx,
            comment: content,
            decision: "allow",
            source: "human_gray",
            postId,
            pendingId: docSnap.id,
          });

          applied += 1;
        });
      } catch (e) {
        errors.push({ id: docSnap.id, error: String(e) });
      }
    }

    // 2) deny → deniedに確定 + examplesへ保存（docId=fingerprint）
    for (const docSnap of denySnap.docs) {
      const p = docSnap.data() as any;

      const postId = String(p.postId ?? "");
      const content = String(p.content ?? "");
      const postEx = excerpt(p.postExcerpt ?? "", 80);
      const topic: Topic = (p.topic as Topic) || inferTopic(postEx);

      try {
        await db.runTransaction(async (tx) => {
          tx.update(docSnap.ref, {
            status: "denied",
            decidedAt: admin.firestore.FieldValue.serverTimestamp(),
          });

          await upsertExampleTx(tx, db, {
            topic,
            postExcerpt: postEx,
            comment: content,
            decision: "deny",
            source: "human_gray",
