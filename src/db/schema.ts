// Inlined (not read from disk) so it ships inside the Vercel function bundle.
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS workspaces (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS leads (
  workspace_id text NOT NULL,
  id text NOT NULL,
  company_id text NOT NULL,
  name text NOT NULL,
  industry text NOT NULL,
  region text NOT NULL,
  persona text NOT NULL,
  contact_name text NOT NULL,
  contact_role text NOT NULL,
  contact_email text NOT NULL,
  state text NOT NULL DEFAULT 'DISCOVERED',
  score int NOT NULL DEFAULT 0,
  score_breakdown jsonb,
  intent int NOT NULL DEFAULT 0,
  trial jsonb,
  brief jsonb,
  call_at text,
  deal_status text,
  shadow jsonb,
  PRIMARY KEY (workspace_id, id)
);
CREATE TABLE IF NOT EXISTS outbox (
  id serial PRIMARY KEY,
  workspace_id text NOT NULL,
  lead_id text NOT NULL,
  direction text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS audit (
  id serial PRIMARY KEY,
  workspace_id text NOT NULL,
  lead_id text,
  actor text NOT NULL,
  action text NOT NULL,
  detail jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS review_queue (
  id serial PRIMARY KEY,
  workspace_id text NOT NULL,
  lead_id text NOT NULL,
  reason text NOT NULL,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS directives (
  workspace_id text NOT NULL,
  lead_id text NOT NULL,
  data jsonb NOT NULL,
  PRIMARY KEY (workspace_id, lead_id)
);
CREATE TABLE IF NOT EXISTS opt_outs (
  workspace_id text NOT NULL,
  email text NOT NULL,
  PRIMARY KEY (workspace_id, email)
);
-- AI reads of a document, keyed by the file's hash + model (identical files are read once).
CREATE TABLE IF NOT EXISTS doc_cache (
  hash text NOT NULL,
  model text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hash, model)
);
CREATE TABLE IF NOT EXISTS usage (
  scope text NOT NULL,
  day text NOT NULL,
  key text NOT NULL,
  count int NOT NULL DEFAULT 0,
  PRIMARY KEY (scope, day, key)
);
`;
