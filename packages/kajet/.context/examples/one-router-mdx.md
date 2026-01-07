# One Router MDX Integration

## Key Takeaways from https://onestack.dev/docs/guides-mdx

### MDX for Static Pages
One Router supports using MDX files for static content pages (like landing pages, documentation, etc.) via `@vxrn/mdx`.

### Setup Pattern
1. Create a `data/` directory for MDX content
2. Use `getAllFrontmatter` and `getMDXBySlug` from `@vxrn/mdx`
3. Use `generateStaticParams()` for SSG
4. Use `loader()` to fetch MDX content
5. Use `getMDXComponent` from `mdx-bundler/client` to render

### Example Route Structure
```tsx
// app/docs/[slug].tsx
export async function generateStaticParams() {
  const { getAllFrontmatter } = await import("@vxrn/mdx");
  const frontmatters = getAllFrontmatter("data");
  return frontmatters.map(({ slug }) => ({ slug }));
}

export async function loader({ params }) {
  const { getMDXBySlug } = await import("@vxrn/mdx");
  const { frontmatter, code } = await getMDXBySlug("data", params.slug);
  return { frontmatter, code };
}

export function Page() {
  const { code, frontmatter } = useLoader(loader);
  const Component = useMemo(() => getMDXComponent(code), [code]);
  return <Component components={customComponents} />;
}
```

### Vite Configuration
```ts
// vite.config.ts
export default defineConfig({
  ssr: {
    noExternal: true,
    external: ['@vxrn/mdx'], // ESM module, must be external
  },
  plugins: [
    one({
      web: {
        defaultRenderMode: 'ssg', // Static Site Generation
      },
    }),
  ],
})
```

## For Kajet
- Landing pages, docs, marketing content → MDX files in `data/`
- Editor content → BlockNote (live editing)
