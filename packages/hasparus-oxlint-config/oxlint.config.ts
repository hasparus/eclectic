import { defineConfig, type DummyRule } from "oxlint";

/** perfectionist default: natural, ascending. */
const natural: DummyRule = ["warn", { type: "natural", order: "asc" }];

export default defineConfig({
  plugins: [
    "typescript",
    "unicorn",
    "import",
    "promise",
    "react"
  ],
  jsPlugins: [
    "eslint-plugin-perfectionist",
    "eslint-plugin-sonarjs",
    "eslint-plugin-better-tailwindcss"
  ],
  categories: { correctness: "off" },
  env: {
    "browser": true,
    "node": true,
    "builtin": true,
    "es2026": true
  },
  ignorePatterns: [
    "dist",
    ".astro",
    "src/routeTree.gen.ts",
    "node_modules",
    "**/.wrangler/tmp/**/*",
    "**/.cache/**/*",
    ".git"
  ],
  rules: {
    "constructor-super": "off",
    "curly": "off",
    "eqeqeq": [
      "warn",
      "always",
      {
        "null": "ignore"
      }
    ],
    "for-direction": "error",
    "getter-return": "off",
    "import/first": "warn",
    "import/newline-after-import": "off",
    "import/no-default-export": "warn",
    "import/no-duplicates": "warn",
    "import/prefer-default-export": "off",
    "jsx-a11y/alt-text": "warn",
    "jsx-a11y/anchor-ambiguous-text": "off",
    "jsx-a11y/anchor-has-content": "warn",
    "jsx-a11y/anchor-is-valid": "warn",
    "jsx-a11y/aria-activedescendant-has-tabindex": "warn",
    "jsx-a11y/aria-props": "warn",
    "jsx-a11y/aria-proptypes": "warn",
    "jsx-a11y/aria-role": "warn",
    "jsx-a11y/aria-unsupported-elements": "warn",
    "jsx-a11y/autocomplete-valid": "warn",
    "jsx-a11y/click-events-have-key-events": "warn",
    "jsx-a11y/control-has-associated-label": [
      "off",
      {
        "ignoreElements": [
          "audio",
          "canvas",
          "embed",
          "input",
          "textarea",
          "tr",
          "video"
        ],
        "ignoreRoles": [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid"
        ],
        "includeRoles": [
          "alert",
          "dialog"
        ]
      }
    ],
    "jsx-a11y/heading-has-content": "warn",
    "jsx-a11y/html-has-lang": "warn",
    "jsx-a11y/iframe-has-title": "warn",
    "jsx-a11y/img-redundant-alt": "warn",
    "jsx-a11y/interactive-supports-focus": [
      "warn",
      {
        "tabbable": [
          "button",
          "checkbox",
          "link",
          "searchbox",
          "spinbutton",
          "switch",
          "textbox"
        ]
      }
    ],
    "jsx-a11y/label-has-associated-control": "warn",
    "jsx-a11y/media-has-caption": "warn",
    "jsx-a11y/mouse-events-have-key-events": "warn",
    "jsx-a11y/no-access-key": "warn",
    "jsx-a11y/no-autofocus": "warn",
    "jsx-a11y/no-distracting-elements": "warn",
    "jsx-a11y/no-interactive-element-to-noninteractive-role": [
      "warn",
      {
        "tr": [
          "none",
          "presentation"
        ],
        "canvas": [
          "img"
        ]
      }
    ],
    "jsx-a11y/no-noninteractive-element-interactions": [
      "warn",
      {
        "handlers": [
          "onClick",
          "onError",
          "onLoad",
          "onMouseDown",
          "onMouseUp",
          "onKeyPress",
          "onKeyDown",
          "onKeyUp"
        ],
        "alert": [
          "onKeyUp",
          "onKeyDown",
          "onKeyPress"
        ],
        "body": [
          "onError",
          "onLoad"
        ],
        "dialog": [
          "onKeyUp",
          "onKeyDown",
          "onKeyPress"
        ],
        "iframe": [
          "onError",
          "onLoad"
        ],
        "img": [
          "onError",
          "onLoad"
        ]
      }
    ],
    "jsx-a11y/no-noninteractive-element-to-interactive-role": [
      "warn",
      {
        "ul": [
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "tablist",
          "tree",
          "treegrid"
        ],
        "ol": [
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "tablist",
          "tree",
          "treegrid"
        ],
        "li": [
          "menuitem",
          "menuitemradio",
          "menuitemcheckbox",
          "option",
          "row",
          "tab",
          "treeitem"
        ],
        "table": [
          "grid"
        ],
        "td": [
          "gridcell"
        ],
        "fieldset": [
          "radiogroup",
          "presentation"
        ]
      }
    ],
    "jsx-a11y/no-noninteractive-tabindex": [
      "warn",
      {
        "tags": [],
        "roles": [
          "tabpanel"
        ],
        "allowExpressionValues": true
      }
    ],
    "jsx-a11y/no-redundant-roles": "warn",
    "jsx-a11y/no-static-element-interactions": [
      "warn",
      {
        "allowExpressionValues": true,
        "handlers": [
          "onClick",
          "onMouseDown",
          "onMouseUp",
          "onKeyPress",
          "onKeyDown",
          "onKeyUp"
        ]
      }
    ],
    "jsx-a11y/role-has-required-aria-props": "warn",
    "jsx-a11y/role-supports-aria-props": "warn",
    "jsx-a11y/scope": "warn",
    "jsx-a11y/tabindex-no-positive": "warn",
    "logical-assignment-operators": [
      "warn",
      "always",
      {
        "enforceForIfStatements": true
      }
    ],
    "no-array-constructor": "warn",
    "no-async-promise-executor": "error",
    "no-case-declarations": "warn",
    "no-class-assign": "off",
    "no-compare-neg-zero": "error",
    "no-cond-assign": "error",
    "no-console": "warn",
    "no-const-assign": "off",
    "no-constant-binary-expression": "error",
    "no-constant-condition": "error",
    "no-control-regex": "warn",
    "no-debugger": "error",
    "no-delete-var": "error",
    "no-dupe-class-members": "off",
    "no-dupe-else-if": "error",
    "no-dupe-keys": "off",
    "no-duplicate-case": "error",
    "no-else-return": [
      "warn",
      {
        "allowElseIf": false
      }
    ],
    "no-empty": "warn",
    "no-empty-character-class": "error",
    "no-empty-function": "warn",
    "no-empty-pattern": "error",
    "no-empty-static-block": "warn",
    "no-ex-assign": "error",
    "no-extra-boolean-cast": "warn",
    "no-fallthrough": "error",
    "no-func-assign": "off",
    "no-global-assign": "error",
    "no-implicit-coercion": [
      "warn",
      {
        "boolean": false,
        "disallowTemplateShorthand": true
      }
    ],
    "no-import-assign": "off",
    "no-invalid-regexp": "error",
    "no-irregular-whitespace": "warn",
    "no-lonely-if": "warn",
    "no-loss-of-precision": "error",
    "no-misleading-character-class": "error",
    "no-new-native-nonconstructor": "off",
    "no-nonoctal-decimal-escape": "error",
    "no-obj-calls": "off",
    "no-prototype-builtins": "error",
    "no-redeclare": "off",
    "no-regex-spaces": "warn",
    "no-restricted-globals": [
      "warn",
      "stop",
      "close",
      {
        "message": "Use Number.isNaN instead",
        "name": "isNaN"
      }
    ],
    "no-restricted-imports": [
      "warn",
      {
        "paths": [
          {
            "name": "react",
            "importNames": [
              "PropsWithChildren"
            ],
            "message": "`PropsWithChildren` set `children` as optional, explicitly define `children` field in your type"
          },
          {
            "name": "axios",
            "message": "Use `fetch/node-fetch` instead."
          },
          {
            "name": "moment",
            "message": "Use `dayjs/date-fns` instead."
          },
          {
            "name": "classnames",
            "message": "Use `clsx` instead because he is faster."
          }
        ]
      }
    ],
    "no-self-assign": "error",
    "no-self-compare": "warn",
    "no-setter-return": "off",
    "no-shadow-restricted-names": "error",
    "no-sparse-arrays": "error",
    "no-this-before-super": "off",
    "no-unexpected-multiline": "off",
    "no-unreachable": "off",
    "no-unsafe-finally": "error",
    "no-unsafe-negation": "off",
    "no-unsafe-optional-chaining": "error",
    "no-unused-expressions": "warn",
    "no-unused-labels": "warn",
    "no-unused-private-class-members": "warn",
    "no-unused-vars": [
      "warn",
      {
        "argsIgnorePattern": "^_",
        "caughtErrorsIgnorePattern": "^_",
        "destructuredArrayIgnorePattern": "^_",
        "varsIgnorePattern": "^_"
      }
    ],
    "no-useless-backreference": "error",
    "no-useless-catch": "warn",
    "no-useless-constructor": "warn",
    "no-useless-escape": "warn",
    "no-var": "warn",
    "no-with": "error",
    "object-shorthand": [
      "warn",
      "always"
    ],
    "perfectionist/sort-array-includes": natural,
    "perfectionist/sort-decorators": natural,
    "perfectionist/sort-exports": natural,
    "perfectionist/sort-heritage-clauses": natural,
    "perfectionist/sort-interfaces": natural,
    "perfectionist/sort-intersection-types": natural,
    "perfectionist/sort-jsx-props": "warn",
    "perfectionist/sort-maps": natural,
    "perfectionist/sort-named-exports": natural,
    "perfectionist/sort-named-imports": natural,
    "perfectionist/sort-object-types": [
      "warn",
      {
        "order": "asc",
        "partitionByComment": true,
        "type": "natural"
      }
    ],
    "perfectionist/sort-objects": [
      "warn",
      {
        "order": "asc",
        "partitionByComment": true,
        "type": "natural"
      }
    ],
    "perfectionist/sort-sets": natural,
    "perfectionist/sort-switch-case": natural,
    "perfectionist/sort-union-types": [
      "warn",
      {
        "groups": [
          "unknown",
          "keyword",
          "nullish"
        ],
        "order": "asc",
        "type": "natural"
      }
    ],
    "perfectionist/sort-variable-declarations": natural,
    "prefer-arrow-callback": [
      "warn",
      {
        "allowNamedFunctions": true
      }
    ],
    "prefer-const": [
      "warn",
      {
        "destructuring": "all"
      }
    ],
    "prefer-destructuring": [
      "warn",
      {
        "VariableDeclarator": {
          "object": true
        }
      }
    ],
    "prefer-object-has-own": "warn",
    "prefer-rest-params": "warn",
    "prefer-spread": "warn",
    "promise/no-multiple-resolved": "warn",
    "promise/no-nesting": "warn",
    "react/display-name": "warn",
    "react/exhaustive-deps": "warn",
    "react/hook-use-state": "warn",
    "react/iframe-missing-sandbox": "warn",
    "react/jsx-boolean-value": "warn",
    "react/jsx-curly-brace-presence": "warn",
    "react/jsx-key": "error",
    "react/jsx-no-comment-textnodes": "error",
    "react/jsx-no-duplicate-props": "error",
    "react/jsx-no-literals": "off",
    "react/jsx-no-target-blank": "error",
    "react/jsx-no-undef": "off",
    "react/jsx-no-useless-fragment": "warn",
    "react/no-children-prop": "error",
    "react/no-danger-with-children": "error",
    "react/no-direct-mutation-state": "error",
    "react/no-find-dom-node": "warn",
    "react/no-is-mounted": "warn",
    "react/no-render-return-value": "error",
    "react/no-string-refs": "warn",
    "react/no-unescaped-entities": "off",
    "react/no-unknown-property": "error",
    "react/no-unsafe": "off",
    "react/react-in-jsx-scope": "off",
    "react/rules-of-hooks": "error",
    "react/self-closing-comp": "off",
    "require-await": "off",
    "require-yield": "warn",
    "sonarjs/no-collapsible-if": "off",
    "sonarjs/no-gratuitous-expressions": "warn",
    "sonarjs/no-identical-conditions": "warn",
    "sonarjs/no-inverted-boolean-check": "warn",
    "sonarjs/no-nested-switch": "warn",
    "sonarjs/no-unused-collection": "warn",
    "sonarjs/no-use-of-empty-return-value": "warn",
    "typescript/adjacent-overload-signatures": "warn",
    "typescript/array-type": "warn",
    "typescript/ban-ts-comment": [
      "warn",
      {
        "minimumDescriptionLength": 10
      }
    ],
    "typescript/ban-tslint-comment": "warn",
    "typescript/class-literal-property-style": "warn",
    "typescript/consistent-generic-constructors": "warn",
    "typescript/consistent-indexed-object-style": "warn",
    "typescript/consistent-type-assertions": "warn",
    "typescript/no-confusing-non-null-assertion": "warn",
    "typescript/no-duplicate-enum-values": "error",
    "typescript/no-dynamic-delete": "warn",
    "typescript/no-explicit-any": "warn",
    "typescript/no-extra-non-null-assertion": "warn",
    "typescript/no-extraneous-class": "warn",
    "typescript/no-inferrable-types": "warn",
    "typescript/no-invalid-void-type": "error",
    "typescript/no-misused-new": "error",
    "typescript/no-namespace": "warn",
    "typescript/no-non-null-asserted-nullish-coalescing": "error",
    "typescript/no-non-null-asserted-optional-chain": "error",
    "typescript/no-require-imports": "warn",
    "typescript/no-this-alias": "warn",
    "typescript/no-unnecessary-type-constraint": "warn",
    "typescript/no-unsafe-declaration-merging": "error",
    "typescript/no-unsafe-function-type": "error",
    "typescript/no-wrapper-object-types": "warn",
    "typescript/prefer-as-const": "warn",
    "typescript/prefer-for-of": "warn",
    "typescript/prefer-function-type": "warn",
    "typescript/prefer-literal-enum-member": "warn",
    "typescript/prefer-namespace-keyword": "warn",
    "typescript/triple-slash-reference": "warn",
    "typescript/unified-signatures": "warn",
    "unicorn/catch-error-name": "warn",
    "unicorn/consistent-assert": "warn",
    "unicorn/consistent-date-clone": "warn",
    "unicorn/consistent-empty-array-spread": "warn",
    "unicorn/consistent-existence-index-check": "warn",
    "unicorn/consistent-function-scoping": "warn",
    "unicorn/empty-brace-spaces": "warn",
    "unicorn/error-message": "warn",
    "unicorn/escape-case": "warn",
    "unicorn/explicit-length-check": "warn",
    "unicorn/new-for-builtins": "error",
    "unicorn/no-abusive-eslint-disable": "warn",
    "unicorn/no-accessor-recursion": "warn",
    "unicorn/no-anonymous-default-export": "warn",
    "unicorn/no-array-for-each": "warn",
    "unicorn/no-array-method-this-argument": "warn",
    "unicorn/no-array-reduce": "warn",
    "unicorn/no-array-reverse": "warn",
    "unicorn/no-await-expression-member": "warn",
    "unicorn/no-await-in-promise-methods": "error",
    "unicorn/no-console-spaces": "warn",
    "unicorn/no-document-cookie": "warn",
    "unicorn/no-empty-file": "warn",
    "unicorn/no-hex-escape": "warn",
    "unicorn/no-immediate-mutation": "warn",
    "unicorn/no-instanceof-array": "warn",
    "unicorn/no-instanceof-builtins": "warn",
    "unicorn/no-invalid-fetch-options": "error",
    "unicorn/no-invalid-remove-event-listener": "error",
    "unicorn/no-lonely-if": "warn",
    "unicorn/no-magic-array-flat-depth": "warn",
    "unicorn/no-negated-condition": "warn",
    "unicorn/no-negation-in-equality-check": "warn",
    "unicorn/no-new-array": "warn",
    "unicorn/no-new-buffer": "error",
    "unicorn/no-object-as-default-parameter": "warn",
    "unicorn/no-process-exit": "warn",
    "unicorn/no-single-promise-in-promise-methods": "warn",
    "unicorn/no-static-only-class": "warn",
    "unicorn/no-thenable": "error",
    "unicorn/no-this-assignment": "warn",
    "unicorn/no-typeof-undefined": "warn",
    "unicorn/no-unnecessary-array-flat-depth": "warn",
    "unicorn/no-unnecessary-array-splice-count": "warn",
    "unicorn/no-unnecessary-await": "warn",
    "unicorn/no-unnecessary-slice-end": "warn",
    "unicorn/no-unreadable-array-destructuring": "warn",
    "unicorn/no-unreadable-iife": "warn",
    "unicorn/no-useless-collection-argument": "warn",
    "unicorn/no-useless-error-capture-stack-trace": "warn",
    "unicorn/no-useless-fallback-in-spread": "warn",
    "unicorn/no-useless-length-check": "warn",
    "unicorn/no-useless-promise-resolve-reject": "warn",
    "unicorn/no-useless-spread": "warn",
    "unicorn/no-useless-switch-case": "warn",
    "unicorn/no-useless-undefined": "warn",
    "unicorn/no-zero-fractions": "warn",
    "unicorn/number-literal-case": "warn",
    "unicorn/numeric-separators-style": "warn",
    "unicorn/prefer-add-event-listener": "warn",
    "unicorn/prefer-array-find": "warn",
    "unicorn/prefer-array-flat": "warn",
    "unicorn/prefer-array-flat-map": "warn",
    "unicorn/prefer-array-index-of": "warn",
    "unicorn/prefer-array-some": "warn",
    "unicorn/prefer-at": "warn",
    "unicorn/prefer-bigint-literals": "warn",
    "unicorn/prefer-blob-reading-methods": "warn",
    "unicorn/prefer-class-fields": "warn",
    "unicorn/prefer-classlist-toggle": "warn",
    "unicorn/prefer-code-point": "warn",
    "unicorn/prefer-date-now": "warn",
    "unicorn/prefer-default-parameters": "warn",
    "unicorn/prefer-dom-node-append": "warn",
    "unicorn/prefer-dom-node-dataset": "warn",
    "unicorn/prefer-dom-node-remove": "warn",
    "unicorn/prefer-dom-node-text-content": "warn",
    "unicorn/prefer-event-target": "warn",
    "unicorn/prefer-export-from": "warn",
    "unicorn/prefer-global-this": "warn",
    "unicorn/prefer-includes": "warn",
    "unicorn/prefer-keyboard-event-key": "warn",
    "unicorn/prefer-logical-operator-over-ternary": "warn",
    "unicorn/prefer-math-min-max": "warn",
    "unicorn/prefer-math-trunc": "warn",
    "unicorn/prefer-modern-dom-apis": "warn",
    "unicorn/prefer-modern-math-apis": "warn",
    "unicorn/prefer-module": "warn",
    "unicorn/prefer-native-coercion-functions": "warn",
    "unicorn/prefer-negative-index": "warn",
    "unicorn/prefer-node-protocol": "warn",
    "unicorn/prefer-number-properties": "warn",
    "unicorn/prefer-object-from-entries": "warn",
    "unicorn/prefer-optional-catch-binding": "warn",
    "unicorn/prefer-prototype-methods": "warn",
    "unicorn/prefer-reflect-apply": "warn",
    "unicorn/prefer-regexp-test": "warn",
    "unicorn/prefer-response-static-json": "warn",
    "unicorn/prefer-set-has": "warn",
    "unicorn/prefer-set-size": "warn",
    "unicorn/prefer-single-call": "warn",
    "unicorn/prefer-spread": "warn",
    "unicorn/prefer-string-raw": "warn",
    "unicorn/prefer-string-replace-all": "warn",
    "unicorn/prefer-string-slice": "warn",
    "unicorn/prefer-string-starts-ends-with": "warn",
    "unicorn/prefer-string-trim-start-end": "warn",
    "unicorn/prefer-structured-clone": "warn",
    "unicorn/prefer-ternary": "warn",
    "unicorn/prefer-top-level-await": "warn",
    "unicorn/prefer-type-error": "warn",
    "unicorn/relative-url-style": "warn",
    "unicorn/require-array-join-separator": "warn",
    "unicorn/require-module-attributes": "warn",
    "unicorn/require-module-specifiers": "warn",
    "unicorn/require-number-to-fixed-digits-argument": "warn",
    "unicorn/text-encoding-identifier-case": "warn",
    "unicorn/throw-new-error": "warn",
    "use-isnan": "error",
    "valid-typeof": "error",
    "yoda": "warn",
  },
  overrides: [
    {
      files: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"],
      rules: { "no-with": "off" },
    },
    {
      files: ["**/*.d.ts", "**/*.config.*", "*.config.*"],
      rules: { "import/no-default-export": "off", "no-var": "off" },
    },
    {
      files: ["**/*.tsx", "**/*.jsx"],
      rules: {
        "better-tailwindcss/enforce-canonical-classes": "warn",
        "better-tailwindcss/no-conflicting-classes": "warn",
        "better-tailwindcss/no-deprecated-classes": "warn",
        "better-tailwindcss/no-duplicate-classes": "warn",
        "better-tailwindcss/no-unknown-classes": "warn",
        "better-tailwindcss/no-unnecessary-whitespace": "warn",
      },
    },
  ],
});
