-- Temporary diagnostic — isolates whether the INSERT's own check passes vs
-- whether it's specifically the RETURNING/select-visibility step that fails.
-- security invoker (the default) so this runs with the CALLING user's exact
-- privileges, same as a real client request.
create or replace function debug_test_insert()
returns text
language plpgsql
security invoker
as $$
declare
  test_id uuid;
  err_msg text;
  found_row boolean;
begin
  -- Step 1: insert WITHOUT returning, to isolate the INSERT ... WITH CHECK policy alone.
  begin
    insert into projects (title, initiator_id) values ('debug test', auth.uid());
  exception when others then
    get stacked diagnostics err_msg = message_text;
    return 'STEP1 insert-without-returning FAILED: ' || err_msg;
  end;

  -- Step 2: can we SELECT it back (tests the SELECT policy / is_project_participant)?
  begin
    select id into test_id from projects where title = 'debug test' and initiator_id = auth.uid() limit 1;
    found_row := test_id is not null;
  exception when others then
    get stacked diagnostics err_msg = message_text;
    delete from projects where title = 'debug test' and initiator_id = auth.uid();
    return 'STEP2 select-back FAILED: ' || err_msg;
  end;

  -- Cleanup
  delete from projects where title = 'debug test' and initiator_id = auth.uid();

  return 'STEP1 insert OK, STEP2 select-back found_row=' || found_row::text;
end;
$$;

grant execute on function debug_test_insert() to authenticated;
