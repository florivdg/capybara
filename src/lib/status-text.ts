import type { DisplayStatus } from './server/display'

/** The status as the page shows it; used by both the server render and client updates. */
export const statusText = ({ animation, clients }: DisplayStatus) => ({
  animation: animation ?? 'none',
  clients: clients.join(', ') || 'none',
})
