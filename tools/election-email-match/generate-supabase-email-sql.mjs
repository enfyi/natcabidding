import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const workbookPath = "/Users/michaelschoelen/Documents/Codex/NATCA ZLA/outputs/election-email-match/2026 election - BUE email lookup.xlsx";
const outputDir = "/Users/michaelschoelen/Documents/Codex/NATCA ZLA/outputs/election-email-match";

const input = await FileBlob.load(workbookPath);
const workbook = await SpreadsheetFile.importXlsx(input);
const sheet = workbook.worksheets.getItem("BUE Email Lookup");
const values = sheet.getUsedRange().values;
const headers = values[0];

const indexOf = (name) => {
  const index = headers.indexOf(name);
  if (index === -1) throw new Error(`Missing expected column: ${name}`);
  return index;
};

const idx = {
  bue: indexOf("BUE"),
  email: indexOf("Email"),
};

const sqlString = (value) => {
  if (value === null || value === undefined || value === "") return "null";
  return `'${String(value).replaceAll("'", "''")}'`;
};
const splitBue = (bue) => {
  const cleaned = String(bue ?? "").replace(/\s+\(\d+\)\s*$/, "");
  const [last, first] = cleaned.split(",").map((part) => part.trim());
  return { firstName: first ?? "", lastName: last ?? "" };
};

const rows = values
  .slice(1)
  .filter((row) => row[idx.email])
  .map((row) => {
    const { firstName, lastName } = splitBue(row[idx.bue]);
    return {
      firstName,
      lastName,
      email: row[idx.email],
    };
  });

const valuesSql = rows
  .map((row) => `(${[
    sqlString(row.firstName),
    sqlString(row.lastName),
    sqlString(row.email),
  ].join(", ")})`)
  .join(",\n");

const cte = `with email_import(first_name, last_name, email) as (\n  values\n${valuesSql}\n)`;

const dryRun = `${cte},\nmatched_bidders as (\n  select b.id, b.first_name, b.last_name, b.email as existing_email, i.email as import_email\n  from public.bidders b\n  join email_import i\n    on lower(trim(b.first_name)) = lower(trim(i.first_name))\n   and lower(trim(b.last_name)) = lower(trim(i.last_name))\n),\nmatched_staging as (\n  select s.id, s.first_name, s.last_name, s.email as existing_email, i.email as import_email\n  from public.staging_seniority_roster s\n  join email_import i\n    on lower(trim(s.first_name)) = lower(trim(i.first_name))\n   and lower(trim(s.last_name)) = lower(trim(i.last_name))\n)\nselect\n  (select count(*) from email_import) as import_email_rows,\n  (select count(*) from matched_bidders) as matched_bidders,\n  (select count(*) from matched_bidders where existing_email is distinct from import_email) as bidders_to_update,\n  (select count(*) from matched_staging) as matched_staging,\n  (select count(*) from matched_staging where existing_email is distinct from import_email) as staging_to_update,\n  (select count(*) from email_import i where not exists (\n    select 1 from public.bidders b where lower(trim(b.first_name)) = lower(trim(i.first_name)) and lower(trim(b.last_name)) = lower(trim(i.last_name))\n  )) as import_rows_not_in_bidders,\n  (select count(*) from (\n    select lower(trim(first_name)) as first_name, lower(trim(last_name)) as last_name, count(*)\n    from public.bidders\n    group by 1, 2\n    having count(*) > 1\n  ) duplicate_names) as duplicate_bidder_names;`;

const update = `${cte},\nupdated_bidders as (\n  update public.bidders b\n  set email = i.email,\n      updated_at = now()\n  from email_import i\n  where lower(trim(b.first_name)) = lower(trim(i.first_name))\n    and lower(trim(b.last_name)) = lower(trim(i.last_name))\n    and b.email is distinct from i.email\n  returning b.id\n),\nupdated_staging as (\n  update public.staging_seniority_roster s\n  set email = i.email\n  from email_import i\n  where lower(trim(s.first_name)) = lower(trim(i.first_name))\n    and lower(trim(s.last_name)) = lower(trim(i.last_name))\n    and s.email is distinct from i.email\n  returning s.id\n)\nselect\n  (select count(*) from email_import) as import_email_rows,\n  (select count(*) from updated_bidders) as updated_bidders,\n  (select count(*) from updated_staging) as updated_staging;`;

const postVerify = `select\n  count(*) as bidders_total,\n  count(*) filter (where nullif(trim(email), '') is not null) as bidders_with_email,\n  count(*) filter (where nullif(trim(email), '') is null) as bidders_missing_email\nfrom public.bidders;\n\nselect\n  count(*) as staging_total,\n  count(*) filter (where nullif(trim(email), '') is not null) as staging_with_email,\n  count(*) filter (where nullif(trim(email), '') is null) as staging_missing_email\nfrom public.staging_seniority_roster;`;

await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(`${outputDir}/supabase-email-dry-run.sql`, dryRun);
await fs.writeFile(`${outputDir}/supabase-email-update.sql`, update);
await fs.writeFile(`${outputDir}/supabase-email-verify.sql`, postVerify);

console.log(JSON.stringify({
  importEmailRows: rows.length,
  dryRunPath: `${outputDir}/supabase-email-dry-run.sql`,
  updatePath: `${outputDir}/supabase-email-update.sql`,
  verifyPath: `${outputDir}/supabase-email-verify.sql`,
}, null, 2));
