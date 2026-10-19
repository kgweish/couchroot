const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.xml': 'application/xml', '.woff2': 'font/woff2' };
const previewFiles = new Set(['fixtures.js', 'scenarios.js', 'runtime.js', 'workbench.js', 'workbench.css', 'tvos-concept.js', 'tvos-concept.css']);
for (const file of ['plex.svg', 'youtube.svg', 'netflix.png', 'prime.png', 'disney.jpg', 'hulu.svg', 'spotify.svg', 'peacock.png', 'crunchyroll.jpg', 'espn.png', 'tubi.png']) {
  previewFiles.add('logos/' + file);
}
function revision() {
  const hash = crypto.createHash('sha256');
  for (const folder of ['web', 'preview']) {
    for (const name of fs.readdirSync(path.join(root, folder), { recursive: true }).sort()) {
      const stat = fs.statSync(path.join(root, folder, name));
      if (stat.isFile()) hash.update(`${folder}/${name}:${stat.mtimeMs}:${stat.size}`);
    }
  }
  return hash.digest('hex');
}
function createServer() {
  return http.createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      let file, body;
      if (pathname === '/__preview/version') {
        res.setHeader('Content-Type', 'text/plain'); res.end(req.method === 'HEAD' ? undefined : revision()); return;
      }
      if (pathname === '/') file = path.join(__dirname, 'index.html');
      else if (pathname === '/hub') {
        file = path.join(root, 'web/index.html');
        body = fs.readFileSync(file, 'utf8').replace('<head>', '<head>\n  <base href="/web/">\n  <script src="/preview/fixtures.js"></script>\n  <script src="/preview/scenarios.js"></script>\n  <script src="/preview/runtime.js"></script>');
        // Allow loopback reload polling and the asset base only in the injected preview.
        body = body.replace("connect-src 'none'", "connect-src 'self'").replace("base-uri 'none'", "base-uri 'self'");
        if (new URL(req.url, 'http://localhost').searchParams.get('scenario') === 'tvos-concept') {
          body = body.replace('</head>', '  <link rel="stylesheet" href="/preview/tvos-concept.css">\n  <script src="/preview/tvos-concept.js" defer></script>\n</head>');
        }
      } else if (pathname.startsWith('/preview/') && previewFiles.has(pathname.slice(9))) {
        file = path.join(__dirname, pathname.slice(9));
      } else if (pathname.startsWith('/web/')) {
        const relative = pathname.slice(5);
        if (relative.split('/').some(part => !part || part.startsWith('.'))) { res.writeHead(404).end(); return; }
        file = path.resolve(root, 'web', relative);
        const real = fs.realpathSync(file);
        if (!real.startsWith(path.join(root, 'web') + path.sep)) { res.writeHead(404).end(); return; }
      } else { res.writeHead(404).end(); return; }
      body = body === undefined ? fs.readFileSync(file) : body;
      res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch (error) {
      res.writeHead(['ENOENT', 'ENOTDIR', 'EISDIR'].includes(error.code) || error instanceof URIError ? 404 : 500).end();
    }
  });
}
async function start(port = 8766) {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}
module.exports = { createServer, start };
if (require.main === module) {
  const port = Number(process.env.PORT || 8766);
  start(port).then(({ server, url }) => {
    console.log(`Minimal Hub UI workbench: ${url}\nSave web/ files to reload. Ctrl+C to stop.`);
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
