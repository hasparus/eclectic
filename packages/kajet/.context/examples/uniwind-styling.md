# Uniwind Cross-Platform Styling

## Overview
Uniwind is a Tailwind-to-React-Native styling solution that works across Web and Native.

## Key Concepts

### Cross-Platform Styling
- **Web**: Tailwind CSS (standard)
- **Mobile**: Uniwind (Tailwind for React Native)
- Same `className` prop works everywhere

### Platform Selectors
```tsx
<View className="ios:pt-12 android:pt-6 web:pt-4" />
<View className="native:bg-blue-500 web:bg-gray-500" />
```

- `ios:` - iOS only
- `android:` - Android only
- `native:` - Both iOS and Android
- `web:` - Web only

### Theme Support
```css
@layer theme {
  :root {
    --color-primary: #3b82f6;
    
    @variant dark {
      --color-primary: #60a5fa;
    }
    
    @media ios {
      --font-sans: "SF Pro Text";
    }
    
    @media android {
      --font-sans: "Roboto";
    }
  }
}
```

### CSS Variables
- Use `light-dark()` for theme-aware colors
- Use `useCSSVariable()` hook to access variables in JS
- Define in `global.css` with `@theme` directive

### Metro Configuration
```js
// metro.config.js
const { withUniwindConfig } = require('uniwind/metro');

module.exports = withUniwindConfig(config, {
  cssEntryFile: './src/global.css',
  extraThemes: ['ocean', 'sunset'],
});
```

## For Kajet
- Use Tailwind on web
- Use Uniwind on mobile (same syntax)
- Share `global.css` across platforms
- Platform-specific overrides via selectors
