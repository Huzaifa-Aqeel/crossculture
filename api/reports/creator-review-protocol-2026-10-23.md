# Creator recommendation review protocol

This is an evaluation procedure, not a result or a claim of accuracy. Reviewers must inspect the linked videos rather than accept the application's rationale as evidence.

## Freeze the sample

For each dated live Brand × YouTube run, export the private 15-day decision record with `node --env-file=../.env.local scripts/export-youtube-review.mjs <run-uuid> > review-packet.json` from `api/`. The packet includes shortlisted and deeply reviewed unverified channels. Record the Qloo brand ID and source response IDs, campaign mode, search coverage, exact channel URL, content links, and observation date. Keep the packet private. A run with unreviewed candidate channels cannot establish discovery recall.

Include varied US brands and creator niches. Deliberately seek cases with one viral relevant video amid unrelated uploads, recurring content expressed in different language from Qloo, critical discussion of a topic, an old niche the creator has left, and a small body of unusually deep work. Do not select cases solely because the application already called them Supported.

## Independent review

Two people independently inspect the public channel and source videos, including representative videos that did not match the proposed bridge. Each records whether the bridge is genuine, representative, correctly interpreted, current for the campaign, and worth investigating. Use `relevant`, `not_relevant`, or `conditional` for the overall investigation decision. Keep the reviewer fields separate; adjudicate disagreements in writing. Leave `adjudicatedLabel` null until that happens. Do not infer shared customers, sales effects, or sponsorship from cultural evidence.

## Metrics

Run `node scripts/score-youtube-review.mjs review-packet.json` only after adjudication. The script reports assessed precision and recall among **reviewed** candidates. Precision@10 remains null unless all ten ranked recommendations have relevant/not-relevant adjudications. Report the conditional count, transcript coverage, channel inventory coverage, profile screening coverage, and provider interruptions alongside quality metrics. These reviewed-candidate metrics do not measure recall over the channels never discovered or never assessed.

Compare against a category or keyword-only discovery baseline at the same YouTube search and review budget before claiming that Qloo improves creator matching. Preserve Qloo's actual response IDs and search directions in developer evidence; never manufacture cultural signals or reviewer decisions.
