import { NextResponse } from "next/server";
import { getAdminDb, admin } from "@/lib/firebase/admin";

function requireAdmin(req: Request) {
  const token = process.env.MODERATION_ADMIN_TOKEN;
  if (!token) throw new Error("MODERATION_ADMIN_TOKEN missing");

  const h = req.headers.get("x-admin-token") || "";
  if (h !== token) return false;
  return true;
}

export async function POST(req: Request) {
  try {
    if (!requireAdmin(req)) {
      console.log("[apply] unauthorized: missing or invalid token");
      return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
    }

    const db = getAdminDb();

    // status == "allow" の pending を最大50件処理
    const snap = await db.collection("comments_pending")
      .where("status", "==", "allow")
      .limit(50)
      .get();

    console.log(`[apply] pending allow count: ${snap.size}`);

    if (snap.empty) {
      console.log("[apply] no pending allow found");
      return NextResponse.json({ ok: true, applied: 0 });
    }

    let applied = 0;
    let errors: any[] = [];

    for (const docSnap of snap.docs) {
      const p = docSnap.data() as any;
      console.log(`[apply] processing pending: ${docSnap.id}`, p);

      const postId = String(p.postId ?? "");
      const userId = String(p.userId ?? "");
      const content = String(p.content ?? "");

      if (!postId || !content) {
        console.log(`[apply] invalid pending: ${docSnap.id} postId=${postId} content=${content}`);
        await docSnap.ref.update({
          status: "deny",
          decidedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        continue;
      }

      const postRef = db.collection("posts").doc(postId);
      const pendingRef = docSnap.ref;

      try {
        await db.runTransaction(async (tx) => {
          const post = await tx.get(postRef);
          if (!post.exists) {
            console.log(`[apply] post not found: ${postId}`);
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

          applied += 1;
          console.log(`[apply] applied pending: ${docSnap.id} → commentId=${newCommentRef.id}`);
        });
      } catch (txErr) {
        console.log(`[apply] transaction error for pending ${docSnap.id}:`, txErr);
        errors.push({ id: docSnap.id, error: txErr });
      }
    }

    console.log(`[apply] applied count: ${applied}, errors: ${errors.length}`);
    return NextResponse.json({ ok: true, applied, errors });
  } catch (err) {
    console.log("[apply] catch error:", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}