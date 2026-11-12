-- Extend the existing chess modes without changing permissions for other games.
alter table public.board_rooms drop constraint board_rooms_kind_check;
alter table public.board_rooms add constraint board_rooms_kind_check check (kind in ('chess','xiangqi','gomoku','go','connect4'));
alter table public.chess_results drop constraint chess_results_kind_check;
alter table public.chess_results add constraint chess_results_kind_check check (kind in ('chess','xiangqi','gomoku','go','connect4'));
alter policy "not banned can insert chess results" on public.chess_results
with check (
  kind in ('chess','xiangqi','gomoku','go','connect4')
  and result in ('win','loss','draw')
  and moves between 0 and 9999
  and seconds between 0 and 86399
  and (user_id is null or user_id = auth.uid())
  and not coalesce(public.is_banned(), false)
);
