# @hasparus/eslint-config

a strict ESLint configuration for my work at **The Guild**

## Installation

```bash
bun add -d @hasparus/eslint-config eslint
```

## Usage

```typescript
// eslint.config.ts
import hasparus from "@hasparus/eslint-config";
// or import hasparusTheGuild from "@hasparus/eslint-config/the-guild";

export default [...hasparus.theGuild, { ignores: ["dist"] }];
```

## Rules Philosophy

1.  **Type Safety**
2.  **Merge-conflict avoidance**

## Assumption

Your editor / AI agent runs autofix. This config is going to be hellish experience or a waste of tokens without autofixing.

## License

MIT
