import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import vm from 'node:vm'

const source = await readFile(new URL('../lib/supabase/proxy.ts', import.meta.url), 'utf8')
const executable = stripTypeScriptTypes(source.replace(/^import .*\n/gm, '').replace('export async function', 'async function'))
let basePath = ''
const context = vm.createContext({ URL, process: { env: {} },
  getSupabaseEnv: () => ({ url: 'https://example.supabase.co', publishableKey: 'test' }),
  withBasePath: path => `${basePath}${path}`,
  createServerClient: () => ({ auth: { getClaims: async () => ({ data: { claims: { sub: 'admin' } } }) } }),
  NextResponse: {
    next: () => ({ cookies: { getAll: () => [{ name: 'session', value: 'refreshed' }] } }),
    redirect: url => ({ url, cookies: { set: (...cookie) => { context.cookie = cookie } } }),
  },
})
vm.runInContext(executable, context)
for (basePath of ['', '/bidding']) {
  for (const search of ['?page=admin-tools', '?page=leave', '?page=public&area=Area+F&section=RDO']) {
    context.request = { method: 'GET', url: `https://example.com${basePath}/${search}`, nextUrl: { pathname: '/', search } }
    const response = await vm.runInContext('updateSession(request)', context)
    assert.equal(response.url.pathname, `${basePath}/dashboard`)
    assert.equal(response.url.search, search)
    assert.equal(context.cookie[0], 'session')
  }
}
console.log('Authenticated root redirects preserve member/public navigation and session cookies.')
