import Link from "next/link";
import { GlassCard, PrimaryButton, SectionTitle } from "@/components/ui";
import { fetchInstagramMedia } from "@/lib/instagram";

const instagramUrl = "https://www.instagram.com/vasseur_fencing/";

export default async function PortfolioPage() {
  const hasToken = Boolean(process.env.INSTAGRAM_ACCESS_TOKEN);
  const media = hasToken ? await fetchInstagramMedia() : [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xl font-black tracking-tight">Portfolio</div>
          <div className="text-sm text-[var(--muted)]">@vasseur_fencing</div>
        </div>
        <Link href={instagramUrl} target="_blank" rel="noreferrer">
          <PrimaryButton>Open Instagram</PrimaryButton>
        </Link>
      </div>

      <SectionTitle title="Instagram" />
      <GlassCard className="p-3">
        {!hasToken ? (
          <div className="text-sm text-[var(--muted)]">
            Add env vars to enable in-app Instagram sync:
            <div className="mt-2 font-mono text-[12px] text-[rgba(255,255,255,.85)]">
              INSTAGRAM_ACCESS_TOKEN
              <br />
              INSTAGRAM_IG_USER_ID (optional)
            </div>
          </div>
        ) : media.length === 0 ? (
          <div className="text-sm text-[var(--muted)]">No media returned yet (check token/user id permissions).</div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {media.slice(0, 30).map((m) => {
              const src = m.media_type === "VIDEO" ? m.thumbnail_url ?? m.media_url : m.media_url;
              return (
                <Link
                  key={m.id}
                  href={m.permalink ?? instagramUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded-2xl overflow-hidden border border-[rgba(255,255,255,.12)] bg-[rgba(255,255,255,.06)]"
                >
                  {src ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={src} alt="" className="w-full aspect-square object-cover" />
                  ) : (
                    <div className="w-full aspect-square grid place-items-center text-[11px] text-[var(--muted)]">No image</div>
                  )}
                </Link>
              );
            })}
          </div>
        )}
      </GlassCard>
    </div>
  );
}
