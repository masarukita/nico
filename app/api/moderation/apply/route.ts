// app/api/moderation/apply/route.ts
import { NextResponse } from "next/server";
import { getAdminDb, admin } from "@/lib/firebase/admin";

type Topic = "HEALTH" | "MEETING" | "WORK" | "RELATIONSHIP" | "STUDY" | "ANY";

function requireAdmin(req: Request) {
  const token = process.env.MODERATION_ADMIN_TOKEN;
  if (!token) throw new Error("MODERATION_ADMIN_TOKEN missing");

  const h = req.headers.get("x-admin-token") || "";
  return h === token;
}

function inferTopic(text: string): Topic {
  const t = (text ?? "").toLowerCase();
  const has = (...words: string[]) => words.some((w) => t.includes(w));

  if (has("おなか", "腹", "痛い", "体調", "熱", "頭痛", "しんどい", "眠い", "病院", "だるい")) return "HEALTH";
  if (has("mtg", "meeting", "会議", "打ち合わせ", "定例", "レビュー", "議事録", "1on1")) return "MEETING";
  if (has("仕事", "業務", "顧客", "対応", "依頼", "締切", "提出", "残業", "上司", "同僚")) return "WORK";
  if (has("旦那", "夫", "妻", "彼氏", "彼女", "パートナー", "家族", "子ども", "子供", "嫁")) return "RELATIONSHIP";
  if (has("課題", "レポート", "ゼミ", "研究", "テスト", "勉強", "講義", "履修")) return "STUDY";

  return "ANY";
}

export async function POST(req: Request) {
  try {
    if (!requireAdmin(req)) {
      console.log("[apply] unauthorized (x-admin-token mismatch)");
      return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
    }

    const db = getAdminDb();

    // ① allow を適用（最大50件）
    const allowSnap = await db
      .collection("comments_pending")
      .where("status", "==", "allow")
      .limit(50)
      .get();

    console.log(`[apply] allow count=${allowSnap.size}`);

    let applied = 0;
    const errors: any[] = [];

    for (const docSnap of allowSnap.docs) {
      const p = docSnap.data() as any;

      const pendingId = docSnap.id;
      const postId = String(p.postId ?? "");
      const userId = String(p.userId ?? "");
      const content = String(p.content ?? "");
      const postExcerpt = String(p.postExcerpt ?? "");
      const topic: Topic = inferTopic(postExcerpt || content);

      console.log("[apply] processing allow", { pendingId, postId, userId, topic });

      if (!postId || !content) {
        console.log("[apply] invalid allow pending, mark deny", { pendingId, postId, hasContent: !!content });
        await docSnap.ref.update({
          status: "deny",
          decidedAt: admin.firestore.FieldValue.serverTimestamp(),
          decidedBy: "system",
        });
        continue;
      }

      const postRef = db.collection("posts").doc(postId);
      const pendingRef = docSnap.ref;

      try {
        await db.runTransaction(async (tx) => {
          const post = await tx.get(postRef);
          if (!post.exists) {
            tx.update(pendingRef, {
              status: "deny",
              decidedAt: admin.firestore.FieldValue.serverTimestamp(),
              decidedBy: "system",
            });
            return;
          }

          const curCount = Number((post.data() as any)?.commentCount ?? 0);

          // comments に正式登録
          const newCommentRef = db.collection("comments").doc();
          tx.set(newCommentRef, {
            postId,
            userId,
            content,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });

          tx.update(postRef, { commentCount: curCount + 1 });

          // pending は applied にして履歴として残す（運用に合わせて delete にしてもOK）
          tx.update(pendingRef, {
            status: "applied",
            appliedAt: admin.firestore.FieldValue.serverTimestamp(),
            appliedCommentId: newCommentRef.id,
          });

          // ✅ ここが肝：人間allowの例を蓄積（AIが次回参照）
          const exRef = db.collection("moderation_examples").doc();
          tx.set(exRef, {
            topic,
            decision: "allow",
            postExcerpt: postExcerpt,
            comment: content,
            source: "human_gray",
            pendingId,
            postId,
            decidedAt: admin.firestore.FieldValue.serverTimestamp(),
          });

          applied += 1;
        });
      } catch (e: any) {
        console.log("[apply] transaction error", { pendingId, error: e?.message || String(e) });
        errors.push({ pendingId, error: e?.message || String(e) });
      }
    }

    // ② deny を例として蓄積して閉じる（最大50件）
    const denySnap = await db
      .collection("comments_pending")
      .where("status", "==", "deny")
      .limit(50)
      .get();

    console.log(`[apply] deny count=${denySnap.size}`);

    let denied = 0;

    for (const docSnap of denySnap.docs) {
      const p = docSnap.data() as any;

      const pendingId = docSnap.id;
      const postId = String(p.postId ?? "");
      const userId = String(p.userId ?? "");
      const content = String(p.content ?? "");
      const postExcerpt = String(p.postExcerpt ?? "");
      const topic: Topic = inferTopic(postExcerpt || content);

      // すでに閉じたdenyは二重処理しないため、closedへ
      if ((p.closedAt ?? null) != null) continue;

      try {
        await docSnap.ref.update({
          closedAt: admin.firestore.FieldValue.serverTimestamp(),
          closedBy: "human",
        });

        // deny例として蓄積（AIが「似たのはNG」と学ぶ材料）
        await db.collection("moderation_examples").add({
          topic,
          decision: "deny",
          postExcerpt,
          comment: content,
          source: "human_gray",
          pendingId,
          postId,
          decidedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        denied += 1;
      } catch (e: any) {
        console.log("[apply] deny example save error", { pendingId, error: e?.message || String(e) });
        errors.push({ pendingId, error: e?.message || String(e) });
      }
    }

    console.log(`[apply] result applied=${applied} deniedExamples=${denied} errors=${errors.length}`);
    return NextResponse.json({ ok: true, applied, deniedExamples: denied, errors });
  } catch (err: any) {
    console.log("[apply] catch error:", err?.message || String(err));
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}