import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Clock } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { BlogCover } from "@/components/blog-cover";
import { sortedPosts, formatPostDate } from "@/content/blog";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Blog — CollaboratMD",
  description:
    "Practical writing on medical billing and revenue cycle management: days in A/R, denial codes, clean claim rate, X12 remittances and eligibility.",
};

export default function BlogIndexPage() {
  const posts = sortedPosts();
  const [lead, ...rest] = posts;

  return (
    <PageShell
      eyebrow="Blog"
      title="Notes from inside the revenue cycle"
      lead="Practical writing on the parts of medical billing that actually move the numbers. No vendor talk, no acronym soup."
      wide
    >
      {/* Lead article */}
      <Link
        href={`/blog/${lead.slug}`}
        className="group grid gap-8 rounded-3xl border border-slate-200 bg-white p-6 transition-shadow hover:shadow-xl hover:shadow-slate-900/5 lg:grid-cols-2 lg:p-8"
      >
        <div className="aspect-[16/9] overflow-hidden rounded-2xl">
          <BlogCover variant={lead.cover} id={`cover-${lead.slug}`} />
        </div>
        <div className="flex flex-col justify-center">
          <div className="flex items-center gap-3 text-xs font-semibold">
            <span className="rounded-full bg-green-50 px-3 py-1 text-green-700">{lead.tag}</span>
            <span className="text-slate-500">{formatPostDate(lead.date)}</span>
          </div>
          <h2 className="mt-4 text-2xl font-extrabold leading-tight tracking-tight text-slate-900 group-hover:text-green-700 lg:text-3xl">
            {lead.title}
          </h2>
          <p className="mt-3 text-[15px] leading-relaxed text-slate-600">{lead.excerpt}</p>
          <div className="mt-5 flex items-center gap-4 text-sm text-slate-500">
            <span className="font-medium text-slate-700">{lead.author}</span>
            <span className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" /> {lead.readingMinutes} min read
            </span>
          </div>
          <span className="mt-6 inline-flex items-center gap-2 text-sm font-bold text-green-700">
            Read the article <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </span>
        </div>
      </Link>

      {/* The rest */}
      <div className="mt-10 grid gap-8 md:grid-cols-2">
        {rest.map((post) => (
          <Link
            key={post.slug}
            href={`/blog/${post.slug}`}
            className="group flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white transition-shadow hover:shadow-lg hover:shadow-slate-900/5"
          >
            <div className="aspect-[16/9] overflow-hidden">
              <BlogCover variant={post.cover} id={`cover-${post.slug}`} />
            </div>
            <div className="flex flex-1 flex-col p-6">
              <div className="flex items-center gap-3 text-xs font-semibold">
                <span className="rounded-full bg-green-50 px-3 py-1 text-green-700">{post.tag}</span>
                <span className="text-slate-500">{formatPostDate(post.date)}</span>
              </div>
              <h2 className="mt-3.5 text-lg font-bold leading-snug tracking-tight text-slate-900 group-hover:text-green-700">
                {post.title}
              </h2>
              <p className="mt-2.5 flex-1 text-sm leading-relaxed text-slate-600">{post.excerpt}</p>
              <div className="mt-5 flex items-center gap-4 border-t border-slate-100 pt-4 text-xs text-slate-500">
                <span className="font-medium text-slate-700">{post.author}</span>
                <span className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" /> {post.readingMinutes} min read
                </span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </PageShell>
  );
}
