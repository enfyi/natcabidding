# Previous Years archive

The archive is separate from active bid years, rosters, assignments, and leave capacity.
Apply the migrations, in order, before using it:

- `20261010141042_previous_year_documents.sql`
- `20261010145315_previous_year_web_views.sql`
- `20261010152025_previous_year_mobile_layouts.sql`

The first requires the existing FAQ admin helpers. These migrations do not import or
publish records. The second adds the saved web representation under the same RLS.

## Admin workflow

Open **Admin Console → Previous Years** (`/admin/previous-years`). Choose the year,
area, and RDO Lines, Leave Calendar, or Bid Times, plus Desktop or Mobile layout; upload a Google Sheets `.xlsx`
export (up to 4 MB). **Preview Excel** validates and converts it to a web version.
**Import Excel as Draft** saves the original file and converted representation.
**Preview Page** displays saved drafts before **Publish** exposes them publicly.
Existing records without a web representation need to be reimported.

Replacement requires an inline confirmation, saves a new draft, and uses an
optimistic timestamp check plus a unique year/area/type/layout constraint to prevent
concurrent overwrites. Failed metadata writes clean up new uploads. Old files
become eligible for cleanup only after a successful replacement.

## Mobile layouts

Import desktop and mobile exports as separate records with the same year, area and
kind. Existing records default to Desktop. Publish each layout independently;
replacing one cannot overwrite the other. Examples: the desktop `A.Cal.26.xlsx`
and mobile `A.Cal.26M.xlsx` both use Leave Calendar, with different Layout choices.

Public pages select Mobile for phone user agents, or Desktop for desktop/tablet
agents. A missing preferred layout falls back to Desktop, then whichever published
variant exists. Only published variants are eligible. Layout links allow an explicit
choice and preserve it through document, worksheet and month navigation. Resizing
a desktop browser does not automatically switch workbooks; use the layout link.
Only the selected representation is retrieved and rendered, with no client-side
device library, resize handler, duplicate hidden tables, or background requests.

## Public pages and performance

The public Previous Years section lists small metadata records and links to
`/previous-years/{year}/{area-code}`. The area page renders only the selected
workbook and, for calendars with month headings, the selected month. RDO, calendar,
worksheet and month navigation use ordinary links without prefetching.

Excel conversion happens once during import. Public pages do not download Excel,
load a spreadsheet library, execute formulas, poll, or subscribe to live updates.
The server retrieves the saved representation of the selected document and emits
HTML for the selected section. The archive list excludes the larger JSON payload.
Publication status is checked on every page request; no public snapshot cache can
keep serving a newly unpublished draft. Framework scripts still accompany the
Next.js page, but the archive adds no client component or spreadsheet runtime.

Visible cell text, cached formula values, dates, solid fills, fonts, basic borders,
column widths, merged headings, and simple text equality/contains formatting rules are preserved. Hidden rows/columns/sheets are
excluded. Images, charts, complex conditional formulas, print layouts and interactive
Excel features are not reproduced. Administrators retain access to the original
Excel workbook for comparison. Review the converted page before publishing.

## Access and limits

Only active administrators may upload, modify metadata or view drafts. Anonymous
read access is restricted to published rows. The original files remain in a private
bucket, with administrator downloads using 60-second signed URLs. Existing storage
RLS also permits published original files; the public interface provides page links.

Imports reject macros, empty/unreadable files, over 30 tabs, over 1,000 internal
files, and expanded contents over 32 MB. Web sheets are limited to 2,000 rows,
128 columns and 50,000 cells, and converted workbooks to about 1.5 MB of JSON.
No formulas execute, and React escapes cell text when rendering.

Run `pnpm test:previous-years`. Optional real export paths can be supplied:
`pnpm test:previous-years /path/A.Cal.26.xlsx /path/A.RDO.26.xlsx`.
