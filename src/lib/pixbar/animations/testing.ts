import type { CustomAppFrame } from '../display'

/** The `db` bitmap of a full-screen frame: `[x, y, width, height, pixels]`. */
export function bitmap(frame: CustomAppFrame) {
  const cmd = frame.draw?.[0]
  if (!cmd || !('db' in cmd)) throw new Error('expected a db bitmap')
  return cmd.db
}
