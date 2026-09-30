import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const html = await readFile(new URL('../bidding.html', import.meta.url), 'utf8')
const source = await readFile(new URL('../bidding.js', import.meta.url), 'utf8')

assert.match(html, /data-page="admin"[^>]*data-system-admin-only[\s\S]*data-page="admin-tools"[^>]*data-system-admin-only/)
assert.match(html, /data-page-panel="admin-tools"/)

const adminPage = html.slice(
  html.indexOf('data-page-panel="admin"'),
  html.indexOf('data-page-panel="admin-tools"')
)
const toolsPage = html.slice(
  html.indexOf('data-page-panel="admin-tools"'),
  html.indexOf('data-page-panel="history"')
)

assert.doesNotMatch(adminPage, /data-pilot-admin-card|data-round-rule-editor|data-admin-schedule-rep|data-manual-bid-panel/)
assert.match(toolsPage, /data-bid-window-enforcement-toggle/)
assert.match(toolsPage, /data-pilot-admin-card/)
assert.match(toolsPage, /data-round-rule-editor/)
assert.match(toolsPage, /data-approval-rule-list/)
assert.doesNotMatch(toolsPage, /data-admin-schedule-rep|Schedule Intake Rep|admin-schedule-section/)
assert.match(toolsPage, /data-manual-bid-panel/)
assert.match(toolsPage, /data-email-log/)
assert.match(html, /data-page-panel="intake-schedule"[\s\S]*data-schedule-rep/)

assert.match(source, /\["dashboard", "intake", "intake-schedule", "admin", "admin-tools"\]/)
assert.match(source, /pageName === "admin" \|\| pageName === "admin-tools"/)
assert.match(source, /"admin-tools": "Bidding Setup"/)
assert.match(source, /if \(pageName === "admin-tools"\) renderAdminToolsPage\(\)/)

console.log('Admin-only bidding setup page checks passed.')
