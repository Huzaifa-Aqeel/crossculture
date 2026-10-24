-- Wikidata is no longer a runtime or retained source for the commerce-only app.
delete from catalog.source_items where platform = 'wikidata';
