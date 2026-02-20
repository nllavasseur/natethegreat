## Suggested Supabase tables (no-auth admin)

You can start super simple:

### `quotes`
- id (uuid, pk)
- created_at (timestamptz)
- customer_name (text)
- customer_phone (text)
- customer_email (text)
- project_address (text)
- style_title (text)
- notes (text)
- discount (numeric)
- tax (numeric)
- deposit_total (numeric)
- total (numeric)

### `quote_items`
- id (uuid, pk)
- quote_id (uuid, fk -> quotes.id)
- section (text)  // "materials" | "labor" | "additional"
- name (text)
- qty (numeric)
- unit (text)
- unit_price (numeric)
- line_total (numeric)
- sort (int)

### `calendar_events` (optional)
- id (uuid, pk)
- starts_at (timestamptz)
- ends_at (timestamptz)
- title (text)
- location (text)
- notes (text)

If you want, we can evolve this into:
- `customers`
- `projects`
- `styles`
- `materials` (price book)
