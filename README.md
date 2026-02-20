# Vasseur Estimator (iOS Glass Starter)

A clean, **no-auth** Next.js App Router starter with an iOS-like "glass" feel:
- Bottom tab navigation: **Estimates / Quotes / Calendar**
- Supabase client wrapper (you attach your own tables)
- Quote print route (HTML/CSS print-to-PDF)

## 1) Install
```bash
npm install
```

## 2) Configure Supabase
Copy env file:
```bash
cp .env.example .env.local
```
Then set:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## 3) Run
```bash
npm run dev
```
Open http://localhost:3000

## 4) Where to build next
- UI shell lives in `components/`
- Pages:
  - `app/estimates/page.tsx`
  - `app/quotes/page.tsx`
  - `app/calendar/page.tsx`
  - `app/quotes/print/[id]/page.tsx` (print layout)
- Supabase client: `lib/supabaseClient.ts`
- Suggested schema (optional) in `lib/schema_suggestion.md`

## Notes
- Keep this project in a local folder like `~/Projects/...` (not iCloud Desktop/Documents).
- Don’t commit `.env.local`.
