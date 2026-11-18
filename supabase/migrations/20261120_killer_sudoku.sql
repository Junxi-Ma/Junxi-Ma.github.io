-- 杀手数独：排行榜 + 暂停存档 + 收藏棋谱
-- 依赖已有的 public.sudoku_resolve_name() 和 public.is_banned()。
--
-- 和普通数独（sudoku_*）是两套完全独立的表，不做合并：
--   1) 两种玩法成绩口径不同，混在一张榜里没法比；
--   2) 旧版页面按 user_id 删除 sudoku_saves，不会碰到杀手数独的存档。
--
-- 盘面编码沿用普通数独那一套 81 位定长字符串：
--   givens    题目给定的数字，空格写 0  → ^[0-9]{81}$（杀手玩法里就是单格笼）
--   solution  完整解，没有空的         → ^[1-9]{81}$
--   board     玩家当前的填写，空格写 0  → ^[0-9]{81}$
--   notes     铅笔笔记的位掩码，每格 3 位十六进制，共 243 位 → ^[0-9a-f]{243}$
-- 笼子单独存 jsonb：[[和值, [格子下标...]], ...]，这样题库以后改了，
-- 旧存档也还能原样恢复出当时那一局。

-- ############################################################
-- 1) 排行榜
-- ############################################################
create table if not exists public.killer_records (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) on delete cascade,
  name       text not null default '匿名',
  difficulty text not null check (difficulty in ('easy','medium','hard','expert')),
  seconds    int  not null check (seconds between 0 and 35999),
  mistakes   int  not null default 0 check (mistakes between 0 and 2),
  hints      int  not null default 0 check (hints between 0 and 3),
  created_at timestamptz not null default now()
);
create index if not exists killer_records_lb_idx   on public.killer_records (difficulty, seconds);
create index if not exists killer_records_user_idx on public.killer_records (user_id);

-- 署名以账号资料为准，防止冒名；直接复用普通数独那个函数
drop trigger if exists killer_resolve_name_trg on public.killer_records;
create trigger killer_resolve_name_trg
  before insert on public.killer_records
  for each row execute function public.sudoku_resolve_name();

alter table public.killer_records enable row level security;
revoke all on table public.killer_records from public, anon, authenticated;
grant select, insert on table public.killer_records to anon, authenticated;

drop policy if exists "killer records readable" on public.killer_records;
create policy "killer records readable" on public.killer_records
  for select to anon, authenticated using (true);

drop policy if exists "not banned can insert killer records" on public.killer_records;
create policy "not banned can insert killer records" on public.killer_records
  for insert to anon, authenticated with check (
    (user_id is null or user_id = auth.uid())
    and not coalesce(public.is_banned(), false)
  );

-- ############################################################
-- 2) 暂停存档（每人一份，只留最新）
-- ############################################################
create table if not exists public.killer_saves (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  sid        text not null check (sid ~ '[^[:space:]]'), -- 前端按 user_id + sid 删除指定局
  difficulty text not null check (difficulty in ('easy','medium','hard','expert')),
  puzzle_id  text not null check (puzzle_id ~ '[^[:space:]]'),
  givens     text not null check (givens   ~ '^[0-9]{81}$'),
  solution   text not null check (solution ~ '^[1-9]{81}$'),
  board      text not null check (board    ~ '^[0-9]{81}$'),
  notes      text not null check (notes    ~ '^[0-9a-f]{243}$'),
  cages      jsonb not null check (jsonb_typeof(cages) = 'array' and cages <> '[]'::jsonb),
  seconds    int  not null default 0 check (seconds    between 0 and 35999),
  mistakes   int  not null default 0 check (mistakes   between 0 and 2),
  hints_left int  not null default 3 check (hints_left between 0 and 3),
  updated_at timestamptz not null default now()
);

alter table public.killer_saves enable row level security;
revoke all on table public.killer_saves from public, anon, authenticated;
grant select, insert, update, delete on table public.killer_saves to authenticated;

drop policy if exists "killer saves owner select" on public.killer_saves;
create policy "killer saves owner select" on public.killer_saves
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "killer saves owner insert" on public.killer_saves;
create policy "killer saves owner insert" on public.killer_saves
  for insert to authenticated with check (
    user_id = auth.uid()
    and not coalesce(public.is_banned(), false)
  );

drop policy if exists "killer saves owner update" on public.killer_saves;
create policy "killer saves owner update" on public.killer_saves
  for update to authenticated using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and not coalesce(public.is_banned(), false)
  );

drop policy if exists "killer saves owner delete" on public.killer_saves;
create policy "killer saves owner delete" on public.killer_saves
  for delete to authenticated using (user_id = auth.uid());

-- ############################################################
-- 3) 收藏棋谱（做完一局主动收藏）
-- ############################################################
create table if not exists public.killer_favorites (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  difficulty text not null check (difficulty in ('easy','medium','hard','expert')),
  puzzle_id  text not null check (puzzle_id ~ '[^[:space:]]'),
  givens     text not null check (givens   ~ '^[0-9]{81}$'),
  solution   text not null check (solution ~ '^[1-9]{81}$'),
  cages      jsonb not null check (jsonb_typeof(cages) = 'array' and cages <> '[]'::jsonb),
  seconds    int  not null check (seconds    between 0 and 35999),
  mistakes   int  not null default 0 check (mistakes   between 0 and 2),
  hints_used int  not null default 0 check (hints_used between 0 and 3),
  created_at timestamptz not null default now()
);

create index if not exists killer_favorites_user_idx
  on public.killer_favorites (user_id, created_at desc);

alter table public.killer_favorites enable row level security;
revoke all on table public.killer_favorites from public, anon, authenticated;
grant select, insert, delete on table public.killer_favorites to authenticated;

drop policy if exists "killer favorites owner select" on public.killer_favorites;
create policy "killer favorites owner select" on public.killer_favorites
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "killer favorites owner insert" on public.killer_favorites;
create policy "killer favorites owner insert" on public.killer_favorites
  for insert to authenticated with check (
    user_id = auth.uid()
    and not coalesce(public.is_banned(), false)
  );

drop policy if exists "killer favorites owner delete" on public.killer_favorites;
create policy "killer favorites owner delete" on public.killer_favorites
  for delete to authenticated using (user_id = auth.uid());

notify pgrst, 'reload schema';
