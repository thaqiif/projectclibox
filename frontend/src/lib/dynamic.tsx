import { lazy, Suspense, type ComponentType, type ReactNode } from "react";

interface DynamicOptions {
  loading?: () => ReactNode;
  ssr?: boolean;
}

/** Small Vite equivalent of the subset of next/dynamic used by the reference UI. */
export default function dynamic<P extends object>(
  loader: () => Promise<{ default: ComponentType<P> } | ComponentType<P>>,
  options: DynamicOptions = {}
): ComponentType<P> {
  const LazyComponent = lazy(async () => {
    const loaded = await loader();
    if ("default" in loaded) return loaded;
    return { default: loaded };
  });
  return function DynamicComponent(props: P) {
    return (
      <Suspense fallback={options.loading?.() ?? null}>
        <LazyComponent {...props} />
      </Suspense>
    );
  };
}
