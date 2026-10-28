import { pipeline } from 'node:stream/promises'

export async function sendRunFile(response, resource, { origin, token, head = false }) {
  const prefix = `${origin}/run-files/${token}/`
  const filename = encodeURIComponent(resource.filename).replace(/['()*]/g, char => '%' + char.charCodeAt(0).toString(16))
  try {
    response.writeHead(200, {
      'Content-Type': resource.contentType,
      'Content-Length': resource.size,
      'Content-Disposition': `${resource.attachment ? 'attachment' : 'inline'}; filename*=UTF-8''${filename}`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      // The report can run scripts, but never acquires the Dashboard's origin or API privileges.
      'Content-Security-Policy': [
        'sandbox allow-scripts allow-downloads allow-popups allow-popups-to-escape-sandbox',
        "default-src 'none'", `script-src ${prefix} https: 'unsafe-inline' 'unsafe-eval'`,
        `style-src ${prefix} https: 'unsafe-inline'`, `img-src ${prefix} https: data: blob:`,
        `font-src ${prefix} https: data:`, `connect-src ${prefix} https:`,
        `media-src ${prefix} https: blob:`, "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
      ].join('; '),
      // Module scripts and fetch() originate from the sandbox's opaque origin.
      'Access-Control-Allow-Origin': '*',
    })
    if (head) response.end()
    else await pipeline(resource.handle.createReadStream(), response)
  } finally {
    await resource.handle.close().catch(() => {})
  }
}
