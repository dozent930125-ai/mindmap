-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요.
-- 서버에서 service role 키로만 접근하므로 RLS를 켜고 정책은 만들지 않습니다(외부 직접 접근 차단).

create table if not exists transactions (
  id text primary key,
  occurred_at text not null,          -- KST ISO 문자열 (예: 2026-09-28T14:23:00+09:00)
  amount bigint not null,
  direction text not null check (direction in ('in', 'out')),
  merchant text not null default '',
  source text not null,
  account text,
  balance bigint,
  cancelled boolean not null default false,
  raw text not null default '',
  category_override text,
  created_at timestamptz not null default now()
);
create index if not exists transactions_occurred_at_idx on transactions (occurred_at desc);

create table if not exists rules (
  id text primary key,
  position int not null,
  keyword text not null,
  category text not null,
  direction text not null check (direction in ('in', 'out', 'any'))
);

create table if not exists unparsed (
  id text primary key,
  text text not null,
  received_at timestamptz not null default now()
);

alter table transactions enable row level security;
alter table rules enable row level security;
alter table unparsed enable row level security;
