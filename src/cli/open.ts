// Opens a file in the browser, for `docs`.

/** Opens a file with the system's opener; false when there is none or it fails. */
export async function openInBrowser(path: string): Promise<boolean> {
  const command =
    process.platform === 'darwin' ? ['open', path]
    : process.platform === 'win32' ? ['cmd', '/c', 'start', '', path]
    : ['xdg-open', path];
  try {
    const proc = Bun.spawn(command, { stdout: 'ignore', stderr: 'ignore' });
    return (await proc.exited) === 0;
  } catch {
    return false;
  }
}
