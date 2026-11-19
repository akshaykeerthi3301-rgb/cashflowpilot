import type { NextConfig } from "next";

const config: NextConfig = {
  // PGlite ships a WASM Postgres; keep it out of the server bundle.
  serverExternalPackages: ["@electric-sql/pglite"],
  // The prototype reads its sample PDFs and ERP exports from disk at request time; ship them with those functions.
  outputFileTracingIncludes: { "/api/prototype/**": ["./data/prototype/**"] },
};
export default config;
