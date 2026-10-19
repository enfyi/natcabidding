drop policy if exists "Signed-in users can view intake calendar marks"
on public.intake_calendar_marks;

create policy "Intake team can view calendar marks"
on public.intake_calendar_marks for select to authenticated
using (auth.uid() is not null and (select public.is_current_intake_or_admin()));
