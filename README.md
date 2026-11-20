# Anima

Russian-language anime discovery and watch-party application. Next.js App Router, React, PostgreSQL and Drizzle ORM.

## Included
- 28,886 real, unique MyAnimeList-linked catalog records, searchable offline with pagination, genre/status/year filters and sorting.
- Email/password/name registration, 6-digit expiring verification codes, scrypt password hashing and HttpOnly database-backed sessions.
- Persistent watch lists, profile themes and locally processed custom avatar uploads.
- Public/private invitation-link rooms, up to 50 active users per room, chat, host-only playback/episode synchronization (3-second polling).
- Custom HLS player with actual stream-quality selection, fullscreen, keyboard shortcuts, 90-second skip and error handling.

## Environment
`DATABASE_URL` is required. Schema is in `src/db/schema.ts`; apply with `npx drizzle-kit push` once PostgreSQL is available.

Optional server-only settings:
- `RESEND_API_KEY`: Resend email API key.
- `RESEND_FROM`: Verified sender, e.g. `Anima <hello@your-domain.com>`.
- `ANIMA_HLS_URL`: Authorized HLS master manifest URL. Quality selection uses real manifest tracks; 1440p and 2160p are enabled only when available. This configuration supplies a single demonstration/channel source, not a full per-title video library. A licensed per-anime/per-episode source must be integrated for full title playback.
- `KODIK_API_TOKEN`: Official Kodik API token. Requests are proxied server-side; no tokens are exposed.
- `SENKU_PLAYER_URL_TEMPLATE`: Official HTTPS iframe URL template supplied by your authorized provider, with `{id}` (MAL/Shikimori ID) and `{episode}` placeholders. No undocumented Senku endpoint is assumed. Compatibility depends on the provider's supported identifier mapping.

Without a mail key, a clearly labeled demo verification code is displayed instead of claiming to send an email. Do not use demo email verification for a public production deployment. Without an authorized video source, the custom player shows a local 30-second Big Buck Bunny excerpt (Blender Foundation, CC BY 3.0), with six genuinely encoded HLS tracks: 360p, 480p, 720p, 1080p, 1440p and 2160p. It explicitly identifies this as a demo, not the selected anime. Media attribution is available at `/media/demo/LICENSE.txt`. The reproducible encoder script is `scripts/prepare-demo.mjs`. Third-party sources are not represented as working when unconfigured. Native room synchronization is supported by the Anima player only; iframe players are not synchronized.

## Data and attribution
Catalog based on [manami-project/anime-offline-database](https://github.com/manami-project/anime-offline-database), ODbL 1.0 / DbCL 1.0, updated 2026-07-04. Normalized derivative is available at `/data/catalog.json`, with attribution at `/data/attribution.json`. Posters belong to their respective rights holders and are used to identify catalog works. The hero illustration is custom generated. Catalog availability is not a claim of streaming rights.

`npm run dev` for development; `npm run build` for production compilation. Health endpoint: `/api/health`.
