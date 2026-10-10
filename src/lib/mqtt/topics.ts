/** A topic you can publish to: non-empty, no wildcards. */
export function isValidTopicName(topic: string): boolean {
  return topic.length > 0 && !/[+#]/.test(topic) && !topic.includes('\u0000')
}

/** A subscription filter: `+` matches one level, `#` the rest (and must be last). */
export function isValidTopicFilter(filter: string): boolean {
  if (!filter.length || filter.includes('\u0000')) return false
  const levels = filter.split('/')
  return levels.every((level, i) =>
    level === '#'
      ? i === levels.length - 1
      : level === '+' || !/[+#]/.test(level),
  )
}

export function topicMatches(filter: string, topic: string): boolean {
  // Wildcards at the first level never match system topics like $SYS/...
  if (
    topic.startsWith('$') &&
    (filter.startsWith('+') || filter.startsWith('#'))
  )
    return false
  const f = filter.split('/')
  const t = topic.split('/')
  for (let i = 0; i < f.length; i++) {
    if (f[i] === '#') return true // also matches the parent: "a/#" matches "a"
    if (i >= t.length || (f[i] !== '+' && f[i] !== t[i])) return false
  }
  return f.length === t.length
}
