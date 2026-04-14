// app/post/[id]/page.tsx
// ✅ "use client" は書かない（= Server Component）

import PostDetailClient from "./PostDetailClient";

type PageProps = {
  params: { id: string };
};

export default function PostDetailPage({ params }: PageProps) {
  const { id } = params;
  return <PostDetailClient postId={id} />;
}