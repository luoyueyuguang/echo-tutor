export {}

const procs: Bun.Subprocess[] = []
const spawn = (cmd: string[], name: string) => {
  const p = Bun.spawn(cmd, { stdout: 'inherit', stderr: 'inherit', env: { ...process.env } })
  p.exited.then((code) => {
    if (code !== 0 && code !== 143) console.error(`[${name}] exited with ${code}`)
  })
  procs.push(p)
}
spawn(['bun', '--hot', 'server/index.ts'], 'server')
spawn(['bunx', 'vite'], 'web')
const shutdown = () => {
  for (const p of procs) {
    try {
      p.kill()
    } catch {}
  }
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
await Promise.all(procs.map((p) => p.exited))
