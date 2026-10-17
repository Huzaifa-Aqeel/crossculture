// Read-only audit of the 2026-10-15 03:34 UTC bounded live discovery's retained official API cache.
import { readFile } from "node:fs/promises";
import pg from "pg";
import { selectCreatorLeads } from "../src/creator-research.mjs";

const raw = await readFile(process.env.LOCAL_SUPABASE_STATUS ?? "/tmp/crossculture-supabase-status.env", "utf8");
const vars = Object.fromEntries(raw.trim().split(/\r?\n/).map((line) => {
  const equal = line.indexOf("=");
  return [line.slice(0, equal), line.slice(equal + 1).replace(/^"|"$/g, "")];
}));
if (!vars.DB_URL?.includes("127.0.0.1:")) throw new Error("Local Supabase only.");
const db = new pg.Pool({ connectionString: vars.DB_URL });
try {
  const searches = await db.query(`select fetched_at,payload_json from private.provider_cache
    where provider='youtube' and resource_type='search'
      and fetched_at >= '2026-10-15 03:34:08+00' and fetched_at < '2026-10-15 03:34:11+00'
    order by fetched_at`);
  if (searches.rows.length !== 5) throw new Error(`Expected five search cache rows; got ${searches.rows.length}.`);
  const queues = searches.rows.map((row, index) => {
    const leads = new Map();
    for (const item of row.payload_json.items) {
      const id = item.snippet?.channelId;
      if (id && item.id?.videoId && !leads.has(id)) leads.set(id, { id, videoId: item.id.videoId });
    }
    return { direction: index + 1, leads: [...leads.values()] };
  });
  const selected = selectCreatorLeads(queues, 12);
  const channels = await db.query(`select payload_json,fetched_at from private.provider_cache
    where provider='youtube' and resource_type='channels'
    order by fetched_at desc`);
  const byId = new Map();
  for (const row of channels.rows) {
    const channel = row.payload_json.items?.[0];
    if (channel?.id && !byId.has(channel.id)) byId.set(channel.id, channel);
  }
  console.log(JSON.stringify({ perSearch: queues.map((queue) => queue.leads.length),
    selected: selected.map(({ direction, lead }) => {
      const channel = byId.get(lead.id);
      return { direction, channelId: lead.id, discoveryVideoId: lead.videoId,
        name: channel?.snippet?.title ?? null, country: channel?.snippet?.country ?? null,
        summary: String(channel?.snippet?.description ?? "").slice(0, 260),
        channelCachePresent: Boolean(channel) };
    }) }, null, 2));
} finally { await db.end(); }
