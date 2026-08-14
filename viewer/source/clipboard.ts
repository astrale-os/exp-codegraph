export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    const copied = await Promise.race([
      navigator.clipboard.writeText(text).then(
        () => true,
        () => false,
      ),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 250)),
    ])
    if (copied) return true
  }
  const area = document.createElement('textarea')
  area.value = text
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.append(area)
  try {
    area.select()
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    area.remove()
  }
}
