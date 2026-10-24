-- Search/extract payloads were shared between retired creator and commerce
-- research. Start the commerce-only app with a clean Tavily content cache while
-- retaining usage and quota accounting records.
delete from private.provider_cache
  where provider = 'web' and resource_type in ('search','extract');

-- Historical web source rows that point to YouTube are not commerce evidence.
delete from catalog.source_items
  where platform = 'web' and
    (source_url ~* '^https://([^/]+\.)?youtube\.com/' or
     source_url ~* '^https://youtu\.be/');
