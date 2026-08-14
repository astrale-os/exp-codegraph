import { h, type ComponentChild } from 'preact'

import type { SvgIconElement } from '../../specification/resource/index.ts'

export function ModuleIcon({ icon, class: className }: { icon?: SvgIconElement; class?: string }) {
  const classes = ['nav-module-icon', icon ? 'nav-custom-icon' : 'nav-module-icon-default', className]
    .filter(Boolean)
    .join(' ')
  if (icon) {
    return h(
      icon.name,
      { ...icon.attributes, class: classes, 'aria-hidden': 'true' },
      icon.children.map((child, index) => renderIconElement(child, index)),
    )
  }
  return (
    <svg class={classes} viewBox="0 0 18 18" aria-hidden="true">
      <path d="m3.2 5.1 5.8-2.6 5.8 2.6v7.7L9 15.5l-5.8-2.7z" />
      <path d="m3.2 5.1 5.8 2.7 5.8-2.7M9 7.8v7.7" />
    </svg>
  )
}

function renderIconElement(icon: SvgIconElement, key: number): ComponentChild {
  return h(
    icon.name,
    { ...icon.attributes, key },
    icon.children.map((child, index) => renderIconElement(child, index)),
  )
}
