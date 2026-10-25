import serverless from "serverless-http";
import { httpServer } from "./server.mjs";

export const handler = serverless(httpServer);
