# One Router iOS Native Build Process

## Key Takeaways from https://onestack.dev/docs/guides-ios-native

### Development Mode

**Simple Way (No Custom Native Dependencies)**:
- Use Expo Go app on iOS device
- No need to prebuild
- Just run `one dev` and scan QR code

**Advanced Way (Custom Native Dependencies)**:
- Run `one prebuild` to generate native iOS project
- Use `one run:ios` or open Xcode workspace
- Required for libraries with native code

### Prebuild Process

**Generate Native Code**:
```bash
npm run prebuild:native
# or
one prebuild
```

This creates the `./ios` directory with Xcode project.

**Required Configuration**:

1. **react-native.config.cjs** (project root):
```js
module.exports = {
  commands: [...require('vxrn/react-native-commands')]
}
```

2. **app.json** (for Expo projects):
```json
{
  "expo": {
    "plugins": ["vxrn/expo-plugin"]
  }
}
```

### Running on iOS

**Option 1: CLI**
```bash
one run:ios  # Launch in simulator
```

**Option 2: Xcode**
```bash
open ios/*.xcworkspace
```
Then click Run button in Xcode.

### Building for Production

1. Open `.xcworkspace` in Xcode
2. Configure code signing (Apple Developer account required)
3. Product → Archive
4. Distribute App → Upload to App Store/TestFlight

### Key Technical Details

**Vite as Bundler**:
- One uses Vite instead of Metro for bundling
- Configured via `react-native.config.cjs`

**iOS Build Script Modification**:
For non-Expo projects, modify Xcode build phase:
```bash
export CLI_PATH="$("$NODE_BINARY" --print "require('path').dirname(require.resolve('react-native/package.json')) + '/cli.js'")"
```

## For Kajet

Since we're using **Tauri for desktop** (not React Native iOS):
- The One Router iOS guide is relevant for **mobile app** builds
- Tauri handles desktop (macOS) separately
- We might consider both:
  - **Desktop**: Tauri (macOS, Windows, Linux)
  - **Mobile**: One Router + Expo (iOS, Android)

### Potential Architecture Adjustment

**Current Plan**: Web + Desktop (Tauri)
**Extended Plan**: Web + Desktop (Tauri) + Mobile (One Router + Expo)

If we want a **mobile app** in addition to desktop:
1. Use One Router's native capabilities
2. Run `one prebuild` for iOS/Android
3. Use Uniwind for cross-platform styling
4. Share the same React codebase

**Decision Point**: Do we want native mobile apps, or is Tauri desktop + PWA enough?
