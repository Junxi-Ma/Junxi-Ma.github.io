-- 数独：暂停存档（每人一份）+ 收藏战绩
--
-- 背景：原来只有 sudoku_records 一张榜表，玩家中途有事离开，进度只能留在
-- 这一台设备的 localStorage 里。这里补两张表：
--   sudoku_saves     —— 暂停时上传的存档，主键就是 user_id，天然「每人只留最新一份」
--   sudoku_favorites —— 一局完成后主动收藏的棋谱与成绩
--
-- 盘面统一用 81 位的定长字符串存，避免 jsonb 在校验和索引上的麻烦：
--   givens    题目给定的数字，空格写 0  → ^[0-9]{81}$
--   solution  完整解，没有空的         → ^[1-9]{81}$
--   board     玩家当前的填写，空格写 0  → ^[0-9]{81}$
--   notes     铅笔笔记的位掩码，每格 3 位十六进制（0x000 ~ 0x1ff），共 243 位
--             → ^[0-9a-f]{243}$

create table if not exists public.sudoku_saves (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  difficulty text not null check (difficulty in ('easy','medium','hard','expert')),
  givens     text not null check (givens   ~ '^[0-9]{81}$'),
  solution   text not null check (solution ~ '^[1-9]{81}$'),
  board      text not null check (board    ~ '^[0-9]{81}$'),
  notes      text not null check (notes    ~ '^[0-9a-f]{243}$'),
  seconds    int  not null default 0 check (seconds    between 0 and 35999),
  mistakes   int  not null default 0 check (mistakes   between 0 and 2),
  hints_left int  not null default 3 check (hints_left between 0 and 3),
  updated_at timestamptz not null default now()
);

create table if not exists public.sudoku_favorites (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  difficulty text not null check (difficulty in ('easy','medium','hard','expert')),
  givens     text not null check (givens   ~ '^[0-9]{81}$'),
  solution   text not null check (solution ~ '^[1-9]{81}$'),
  seconds    int  not null check (seconds    between 0 and 35999),
  mistakes   int  not null default 0 check (mistakes   between 0 and 2),
  hints_used int  not null default 0 check (hints_used between 0 and 3),
  created_at timestamptz not null default now()
);

create index if not exists sudoku_favorites_user_idx
  on public.sudoku_favorites (user_id, created_at desc);

-- 两张表都只对本人开放：存档是私人进度，战绩是私人收藏，没有公开读的必要。
alter table public.sudoku_saves enable row level security;
alter table public.sudoku_favorites enable row level security;

drop policy if exists "sudoku saves owner select" on public.sudoku_saves;
create policy "sudoku saves owner select" on public.sudoku_saves
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "sudoku saves owner insert" on public.sudoku_saves;
create policy "sudoku saves owner insert" on public.sudoku_saves
  for insert to authenticated with check (
    user_id = auth.uid()
    and not coalesce(public.is_banned(), false)
  );

drop policy if exists "sudoku saves owner update" on public.sudoku_saves;
create policy "sudoku saves owner update" on public.sudoku_saves
  for update to authenticated using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "sudoku saves owner delete" on public.sudoku_saves;
create policy "sudoku saves owner delete" on public.sudoku_saves
  for delete to authenticated using (user_id = auth.uid());

drop policy if exists "sudoku favorites owner select" on public.sudoku_favorites;
create policy "sudoku favorites owner select" on public.sudoku_favorites
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "sudoku favorites owner insert" on public.sudoku_favorites;
create policy "sudoku favorites owner insert" on public.sudoku_favorites
  for insert to authenticated with check (
    user_id = auth.uid()
    and not coalesce(public.is_banned(), false)
  );

drop policy if exists "sudoku favorites owner delete" on public.sudoku_favorites;
create policy "sudoku favorites owner delete" on public.sudoku_favorites
  for delete to authenticated using (user_id = auth.uid());

notify pgrst, 'reload schema';
