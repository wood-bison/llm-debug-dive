# ADR 0003: Portable semantic visual tokens

The dashboard uses a local snapshot of the Fluent Glass v3 palette from the dotfiles design system. Semantic Tailwind tokens separate surfaces, text, focus, severity and token categories; light and dark themes share component structure. System typography and restrained panel radii suit dense diagnostic data.

Translucency belongs to navigation. Tables, charts and code retain opaque reading surfaces. Reduced transparency, increased contrast and reduced motion preferences remain supported. The custom trace-lens SVG is shared by the app header and favicon. The repository does not depend on an external dotfiles checkout at runtime.
