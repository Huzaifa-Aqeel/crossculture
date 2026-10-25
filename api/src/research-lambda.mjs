import { workOnePersonalRun } from "./personal-research.mjs";

// Both direct API invocations and the scheduled recovery invoke this handler.
// The event is a wake hint; Postgres decides which ready run is claimed.
export async function handler() {
  return { worked: await workOnePersonalRun() };
}
