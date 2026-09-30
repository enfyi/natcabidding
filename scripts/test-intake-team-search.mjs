import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../bidding.js', import.meta.url), 'utf8')

assert.match(source, /data-intake-team-candidate-search/)
assert.match(source, /data-intake-team-candidate-results/)
assert.match(source, /data-intake-team-candidate-result/)
assert.match(source, /function intakeTeamCandidateMatches\(person, query\)/)
assert.match(source, /person\.firstName,[\s\S]*person\.lastName,[\s\S]*person\.initials,[\s\S]*person\.area,[\s\S]*person\.bidAs,[\s\S]*person\.email/)
assert.match(source, /selectedIntakeTeamCandidateInitials = intakeTeamCandidateResult\.dataset\.intakeTeamCandidateResult/)
assert.match(source, /const initials = selectedIntakeTeamCandidateInitials/)
assert.doesNotMatch(source, /<select data-intake-team-candidate>/)

console.log('Intake-team employee search checks passed.')
