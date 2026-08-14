export function PackagesView({ packages }: { packages: readonly string[] }) {
  return (
    <section class="spec-field-view">
      <p class="eyebrow">Authoritative allowlist</p>
      <h2>External packages</h2>
      <ul class="value-list">
        {packages.map((name) => (
          <li key={name}>
            <code>{name}</code>
          </li>
        ))}
      </ul>
    </section>
  )
}
