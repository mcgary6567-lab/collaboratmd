import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, Clock } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { BlogCover } from "@/components/blog-cover";
import { getSession } from "@/lib/auth";
import { getPost, sortedPosts, formatPostDate, type Block } from "@/content/blog";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) return { title: "Article not found — CollaboratMD" };
  return { title: `${post.title} — CollaboratMD`, description: post.excerpt };
}

function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.t) {
          case "h2":
            return (
              <h2 key={i} className="mt-12 text-xl font-bold tracking-tight text-slate-900 lg:text-2xl">
                {b.text}
              </h2>
            );
          case "h3":
            return (
              <h3 key={i} className="mt-8 text-base font-bold text-slate-900">
                {b.text}
              </h3>
            );
          case "p":
            return (
              <p key={i} className="mt-4 text-[17px] leading-[1.75] text-slate-700">
                {b.text}
              </p>
            );
          case "ul":
            return (
              <ul key={i} className="mt-5 space-y-2.5 pl-5">
                {b.items.map((it) => (
                  <li key={it} className="list-disc text-[17px] leading-[1.7] text-slate-700 marker:text-green-600">
                    {it}
                  </li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={i} className="mt-5 space-y-2.5 pl-5">
                {b.items.map((it) => (
                  <li
                    key={it}
                    className="list-decimal text-[17px] leading-[1.7] text-slate-700 marker:font-semibold marker:text-green-600"
                  >
                    {it}
                  </li>
                ))}
              </ol>
            );
          case "quote":
            return (
              <blockquote
                key={i}
                className="my-9 border-l-4 border-green-600 bg-green-50/60 py-5 pl-6 pr-5 text-lg font-medium leading-relaxed text-slate-800"
              >
                {b.text}
              </blockquote>
            );
          case "table":
            return (
              <div key={i} className="my-9 overflow-hidden rounded-2xl border border-slate-200">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left">
                    <tr>
                      {b.head.map((h) => (
                        <th key={h} className="px-5 py-3 font-semibold text-slate-600">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((row) => (
                      <tr key={row.join()} className="border-t border-slate-200">
                        {row.map((cell, c) => (
                          <td
                            key={cell}
                            className={`px-5 py-3.5 ${c === 0 ? "font-semibold text-slate-900" : "text-slate-600"}`}
                          >
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
        }
      })}
    </>
  );
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) notFound();

  const session = await getSession();
  const more = sortedPosts().filter((p) => p.slug !== post.slug).slice(0, 2);

  return (
    <div className="min-h-screen bg-white">
      <SiteHeader signedIn={!!session} />

      <article>
        <header className="relative overflow-hidden border-b border-slate-200 bg-slate-50">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(45rem_22rem_at_50%_-8rem,rgba(22,163,74,0.13),transparent)]"
          />
          <div className="relative mx-auto max-w-3xl px-6 py-14 lg:py-20">
            <Link
              href="/blog"
              className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-green-700"
            >
              <ArrowLeft className="h-4 w-4" /> All articles
            </Link>
            <div className="mt-7 flex items-center gap-3 text-xs font-semibold">
              <span className="rounded-full bg-green-100 px-3 py-1 text-green-800">{post.tag}</span>
              <span className="text-slate-500">{formatPostDate(post.date)}</span>
            </div>
            <h1 className="mt-4 text-3xl font-extrabold leading-tight tracking-tight text-slate-900 sm:text-4xl lg:text-[2.75rem]">
              {post.title}
            </h1>
            <p className="mt-5 text-lg leading-relaxed text-slate-600">{post.excerpt}</p>
            <div className="mt-7 flex items-center gap-4 border-t border-slate-200 pt-6 text-sm">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-600 font-bold text-white">
                {post.author.charAt(0)}
              </div>
              <div>
                <div className="font-semibold text-slate-900">{post.author}</div>
                <div className="text-slate-500">{post.role}</div>
              </div>
              <span className="ml-auto flex items-center gap-1.5 text-slate-500">
                <Clock className="h-4 w-4" /> {post.readingMinutes} min read
              </span>
            </div>
          </div>
        </header>

        <div className="mx-auto max-w-4xl px-6">
          <div className="-mt-0 aspect-[16/7] overflow-hidden rounded-b-2xl">
            <BlogCover variant={post.cover} id={`hero-${post.slug}`} />
          </div>
        </div>

        <div className="mx-auto max-w-3xl px-6 py-12 lg:py-16">
          <Blocks blocks={post.body} />

          <div className="mt-14 rounded-3xl bg-gradient-to-br from-green-700 via-green-600 to-green-500 px-8 py-10 text-center">
            <h2 className="text-xl font-extrabold tracking-tight text-white sm:text-2xl">
              See these numbers on a full-size demo practice
            </h2>
            <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-green-50">
              The demo runs on a synthetic practice of 100 providers, 15,000 patients and 105,000
              claims, scrubbed, submitted, adjudicated by a simulated payer, denied and appealed.
            </p>
            <Link
              href="/login"
              className="mt-6 inline-flex items-center gap-2 rounded-lg bg-white px-6 py-3 text-sm font-bold text-green-700 transition-colors hover:bg-green-50"
            >
              Open the demo <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </article>

      <section className="border-t border-slate-200 bg-slate-50 py-14">
        <div className="mx-auto max-w-5xl px-6">
          <h2 className="text-xs font-bold uppercase tracking-widest text-green-600">Keep reading</h2>
          <div className="mt-6 grid gap-6 md:grid-cols-2">
            {more.map((p) => (
              <Link
                key={p.slug}
                href={`/blog/${p.slug}`}
                className="group flex gap-5 rounded-2xl border border-slate-200 bg-white p-5 transition-shadow hover:shadow-lg hover:shadow-slate-900/5"
              >
                <div className="h-20 w-28 shrink-0 overflow-hidden rounded-xl">
                  <BlogCover variant={p.cover} id={`more-${p.slug}`} />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-green-700">{p.tag}</div>
                  <h3 className="mt-1 text-sm font-bold leading-snug text-slate-900 group-hover:text-green-700">
                    {p.title}
                  </h3>
                  <div className="mt-2 text-xs text-slate-500">{p.readingMinutes} min read</div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
