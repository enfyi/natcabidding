const cacheControl = 'no-store, max-age=0'

export function prototypeFile(file: Buffer, contentType: string) {
  return new Response(new Uint8Array(file), {
    headers: {
      'Cache-Control': cacheControl,
      'Content-Type': contentType,
    },
  })
}
