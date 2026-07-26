# DevCanopy Design System

## Visual thesis

A matte graphite desktop workspace with crisp typography and a single mint-green operational accent. Dense information remains calm through spacing, alignment, and low-contrast dividers rather than stacked cards.

## Layout

- Persistent 224px sidebar for top-level navigation.
- Primary workspace uses a 32px page gutter and a readable maximum width.
- Lists and tables are the default data surface; cards are reserved for selectable projects.
- Use an 8px spacing rhythm and 44px minimum interactive target height.

## Color

- Background: near-black graphite.
- Surfaces: two subtle elevation steps.
- Accent: mint green for primary actions and positive runtime state.
- Status colors always include text or an icon and never rely on color alone.

## Type

- UI: system sans stack for native rendering and multilingual coverage.
- Commands, paths, ports, and timers: system monospace stack with tabular figures.

## Motion

- Route content fades and rises over 180ms.
- Modal surfaces fade and scale over 160ms.
- Interactive rows transition background and border colors over 140ms.
- Respect `prefers-reduced-motion`.

## Accessibility

- Visible focus rings on every control.
- Icon-only buttons require accessible labels.
- Forms use persistent labels and inline errors.
- Primary text targets WCAG AA contrast in both themes.
