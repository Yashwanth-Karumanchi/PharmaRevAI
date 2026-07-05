create extension if not exists vector;

create table if not exists anonymous_users (
  id uuid primary key default gen_random_uuid(),
  anonymous_key text unique not null,
  created_at timestamptz default now(),
  last_seen_at timestamptz default now()
);

create table if not exists chat_sessions (
  id uuid primary key default gen_random_uuid(),
  anonymous_user_id uuid references anonymous_users(id) on delete cascade,
  title text not null default 'New chat',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz
);

create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  chat_session_id uuid references chat_sessions(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  source_name text,
  source_type text,
  dataset_name text,
  title text,
  drug_name text,
  manufacturer text,
  year int,
  url text,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create table if not exists document_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid references documents(id) on delete cascade,
  chunk_text text not null,
  chunk_index int not null default 0,
  drug_name text,
  manufacturer text,
  source_type text,
  year int,
  embedding vector(768),
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create table if not exists rag_traces (
  id uuid primary key default gen_random_uuid(),
  assistant_message_id uuid references chat_messages(id) on delete cascade,
  question text not null,
  route text not null,
  confidence text check (confidence in ('High', 'Medium', 'Low')),
  created_at timestamptz default now()
);

create table if not exists rag_trace_nodes (
  id uuid primary key default gen_random_uuid(),
  rag_trace_id uuid references rag_traces(id) on delete cascade,
  node_key text not null,
  node_type text not null,
  label text not null,
  description text,
  status text,
  score numeric,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create table if not exists rag_trace_edges (
  id uuid primary key default gen_random_uuid(),
  rag_trace_id uuid references rag_traces(id) on delete cascade,
  source_node_key text not null,
  target_node_key text not null,
  label text,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create table if not exists pharma_sales (
  id bigserial primary key,
  sale_timestamp timestamptz,
  drug_name text,
  atc_category text,
  quantity_sold numeric,
  source_dataset text,
  created_at timestamptz default now()
);

create table if not exists cms_part_d_spending (
  id bigserial primary key,
  year int,
  brand_name text,
  generic_name text,
  manufacturer text,
  total_spending numeric,
  total_claims numeric,
  total_beneficiaries numeric,
  avg_spending_per_dosage_unit numeric,
  change_in_avg_spending numeric,
  drug_uses text,
  clinical_indications text,
  source_dataset text,
  created_at timestamptz default now()
);

create table if not exists cms_part_d_prescribers (
  id bigserial primary key,
  year int,
  npi text,
  provider_name text,
  provider_city text,
  provider_state text,
  brand_name text,
  generic_name text,
  total_claim_count numeric,
  total_drug_cost numeric,
  beneficiary_count numeric,
  source_dataset text,
  created_at timestamptz default now()
);

create table if not exists open_payments (
  id bigserial primary key,
  program_year int,
  company_name text,
  physician_name text,
  physician_specialty text,
  recipient_state text,
  payment_amount numeric,
  payment_nature text,
  drug_or_device_name text,
  date_of_payment date,
  source_dataset text,
  created_at timestamptz default now()
);

create index if not exists idx_chat_sessions_user
on chat_sessions(anonymous_user_id);

create index if not exists idx_chat_messages_session
on chat_messages(chat_session_id);

create index if not exists idx_documents_drug_name
on documents(drug_name);

create index if not exists idx_document_chunks_drug_name
on document_chunks(drug_name);

create index if not exists idx_cms_spending_brand_year
on cms_part_d_spending(brand_name, year);

create index if not exists idx_cms_prescribers_brand_state
on cms_part_d_prescribers(brand_name, provider_state);

create index if not exists idx_open_payments_company_year
on open_payments(company_name, program_year);