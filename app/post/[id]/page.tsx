// app/post/[id]/page.tsx
// ✅ "use client" は書かない（= Server Component）

import PostDetailClient from "./PostDetailClient";

/**
 * Next.js 15 系では params が Promise になる場合があるため
 * params を Promise<...> として受けて await で展開する。[1](https://nextjs.org/docs/messages/sync-dynamic-apis)
 */
type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function PostDetailPage({ params }: PageProps) {
  // ✅ ここが超重要：params を await してから使う
  const { id } = await params;

  // クライアント側UIに postId を渡す
  return <PostDetailClient postId={id} />;
}