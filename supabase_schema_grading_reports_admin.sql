alter table grading_reports add column if not exists exam_result_id uuid null references exam_results(id) on delete set null;
alter table grading_reports add column if not exists exam_id text null;
alter table grading_reports add column if not exists faculty_name text null;
alter table grading_reports add column if not exists exam_year integer null;
alter table grading_reports add column if not exists status text not null default 'new';
alter table grading_reports add column if not exists admin_memo text null default '';

drop policy if exists "Admins can read grading reports" on grading_reports;
create policy "Admins can read grading reports"
on grading_reports
for select
to authenticated
using (
    exists (
        select 1
        from profiles
        where profiles.id = auth.uid()
          and profiles.role = 'admin'
    )
);

drop policy if exists "Admins can update grading reports" on grading_reports;
create policy "Admins can update grading reports"
on grading_reports
for update
to authenticated
using (
    exists (
        select 1
        from profiles
        where profiles.id = auth.uid()
          and profiles.role = 'admin'
    )
)
with check (
    exists (
        select 1
        from profiles
        where profiles.id = auth.uid()
          and profiles.role = 'admin'
    )
);

drop policy if exists "Admins can delete grading reports" on grading_reports;
create policy "Admins can delete grading reports"
on grading_reports
for delete
to authenticated
using (
    exists (
        select 1
        from profiles
        where profiles.id = auth.uid()
          and profiles.role = 'admin'
    )
);

drop policy if exists "Admins can read all exam results for reports" on exam_results;
create policy "Admins can read all exam results for reports"
on exam_results
for select
to authenticated
using (
    exists (
        select 1
        from profiles
        where profiles.id = auth.uid()
          and profiles.role = 'admin'
    )
);
