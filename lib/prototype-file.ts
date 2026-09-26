const cacheControl = 'public, max-age=0, must-revalidate'

export function prototypeFile(file: Buffer, contentType: string) {
  return new Response(new Uint8Array(file), {
    headers: {
      'Cache-Control': cacheControl,
      'Content-Type': contentType,
    },
  })
}
