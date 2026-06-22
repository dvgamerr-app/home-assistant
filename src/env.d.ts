/// <reference types="astro/client" />

// Fix: Svelte 5 Component<Props> puts ComponentInternals as the first parameter,
// so TypeScript's JSX extracts Brand<"ComponentInternals"> instead of Props.
// LibraryManagedAttributes intercepts this and returns the correct Props type.
// ponytail: remove when @astrojs/svelte handles Svelte 5 function components in Astro JSX.
// Svelte 5 Component<Props> puts ComponentInternals as the first param, so Astro's JSX
// extracts Brand<"ComponentInternals"> as props instead of Props.
// LibraryManagedAttributes intercepts this and returns the correct Props type.
// ponytail: remove when @astrojs/svelte handles Svelte 5 function-component types natively.
declare namespace astroHTML.JSX {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type LibraryManagedAttributes<C, P> = C extends import('svelte').Component<infer Props, any, any> ? Props & import('@astrojs/svelte/svelte-shims').AstroClientDirectives : P
}
