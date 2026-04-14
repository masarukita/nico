// purge-seed-prod.mjs
import admin from "firebase-admin";
import fs from "node:fs";
import path from "node:path";

/**
 * ========= 設定 =========
 */
const ALLOW_PROJECT_ID = "nico-prod-c637a";          // ★nico-prod の projectId
const SERVICE_ACCOUNT_FILE = "serviceAccountKey.json";
const SEED_TAG = "demo_seed_prod_v1";          // ★seed投入時と同じ値にする
const BATCH_LIMIT = 450;
/* ======================= */

function mustConfirm() {
  if (process.env.PURGE_ALLOW !== "YES") {
    console.log("🛑 安全ガード: 実行するには環境変数 PURGE_ALLOW=YES を付けてください");
    console.log('   例:  PURGE_ALLOW=YES node purge-seed-prod.mjs');
    process.exit(1);
  }
}

async function purgeCollectionBySeedTag(db, colName) {
  const col = db.collection(colName);
  let deleted = 0;

  while (true) {
    // seedTag が一致するものをまとめて取得
    const snap = await col.where("seedTag", "==", SEED_TAG).limit(BATCH_LIMIT).get();

    if (snap.empty) break;

    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();

    deleted += snap.size;
    console.log(`Deleted from ${colName}: ${deleted}`);
  }

  return deleted;
}

async function main() {
  mustConfirm();

  const keyPath = path.resolve(process.cwd(), SERVICE_ACCOUNT_FILE);
  if (!fs.existsSync(keyPath)) {
    console.log(`🛑 ${SERVICE_ACCOUNT_FILE} が見つかりません（nico-app直下に置いてください）`);
    process.exit(1);
  }

  const serviceAccount = JSON.parse(fs.readFileSync(keyPath, "utf-8"));
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

  const projectId = serviceAccount.project_id;
  console.log("Target projectId:", projectId);

  if (projectId !== ALLOW_PROJECT_ID) {
    console.log(`🛑 ガード発動: projectId=${projectId} は許可されていません。`);
    process.exit(1);
  }

  const db = admin.firestore();

  // ✅ 先に comments を消す（参照整合性の気分的に）
  const delComments = await purgeCollectionBySeedTag(db, "comments");
  const delPosts = await purgeCollectionBySeedTag(db, "posts");

  console.log("✅ Purge completed.");
  console.log(`deleted comments=${delComments}, posts=${delPosts}`);
  console.log(`seedTag=${SEED_TAG}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});