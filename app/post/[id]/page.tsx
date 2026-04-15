// app/post/[id]/page.tsx
import PostDetailClient from "./PostDetailClient";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function PostDetailPage({ params }: PageProps) {
  const { id } = await params; // ✅ ここが必須
  return <PostDetailClient postId={id} />;
}
