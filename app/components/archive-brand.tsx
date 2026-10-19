import { withBasePath } from '@/lib/env'

export function ArchiveBrand() {
  return <span className="archive-brand"><img src={withBasePath('/assets/logo-5v2a.png')} alt="" width="44" height="44" /><span><strong>ZLA</strong><small>Los Angeles Center</small></span></span>
}
