export type InstagramMediaItem = {
  id: string;
  caption?: string;
  media_type: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM" | string;
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
  timestamp?: string;
};

type InstagramMediaResponse = {
  data?: InstagramMediaItem[];
  error?: { message?: string };
};

export async function fetchInstagramMedia(): Promise<InstagramMediaItem[]> {
  const token = process.env.INSTAGRAM_ACCESS_TOKEN;
  if (!token) return [];

  const igUserId = process.env.INSTAGRAM_IG_USER_ID;

  const baseUrl = igUserId
    ? `https://graph.facebook.com/v19.0/${encodeURIComponent(igUserId)}/media`
    : "https://graph.instagram.com/me/media";

  const fields = [
    "id",
    "caption",
    "media_type",
    "media_url",
    "thumbnail_url",
    "permalink",
    "timestamp"
  ].join(",");

  const url = `${baseUrl}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(token)}`;

  const res = await fetch(url, {
    next: { revalidate: 60 * 60 * 24 }
  });

  if (!res.ok) return [];

  const json = (await res.json()) as InstagramMediaResponse;
  const data = json.data ?? [];
  return data;
}
