/** The clock couldn't be reached over HTTP, or refused the request. */
export class ClockError extends Error {
  override name = 'ClockError'
}

/**
 * The clock's own HTTP API, for what MQTT can't do. Removing a custom app is
 * one: publishing `{}` over MQTT leaves the app in place (verified on app
 * version 1.1.3), while the same `{}` over HTTP removes it.
 */
export async function removeCustomApp(ip: string, app: string): Promise<void> {
  let response: Response
  try {
    response = await fetch(
      `http://${ip}/api/custom?name=${encodeURIComponent(app)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(5000),
      },
    )
  } catch (error) {
    throw new ClockError(`Couldn't reach the clock at ${ip}`, { cause: error })
  }
  if (!response.ok) {
    throw new ClockError(
      `Clock answered ${response.status} when removing "${app}"`,
    )
  }
}
