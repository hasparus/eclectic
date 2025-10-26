import { format as prettier } from "prettier";
import { diff } from "@vitest/utils/diff";

import { expect } from "vitest";

function format(input: string) {
  return prettier(input.replace(/\n/g, ""), { parser: "css", printWidth: 100 });
}

expect.extend({
  toMatchCss(received: string, argument: string) {
    function stripped(str: string) {
      return str.replace(/\s/g, "").replace(/;/g, "");
    }

    const options = {
      comment: "stripped(received) === stripped(argument)",
      isNot: this.isNot,
      promise: this.promise,
    };

    const pass = stripped(received) === stripped(argument);

    const message = pass
      ? () => {
          return (
            this.utils.matcherHint(
              "toMatchCss",
              undefined,
              undefined,
              options
            ) +
            "\n\n" +
            `Expected: not ${this.utils.printExpected(format(received))}\n` +
            `Received: ${this.utils.printReceived(format(argument))}`
          );
        }
      : () => {
          const actual = format(received);
          const expected = format(argument);

          const diffString = diff(expected, actual, {
            expand: this.expand!,
          });

          return (
            this.utils.matcherHint(
              "toMatchCss",
              undefined,
              undefined,
              options
            ) +
            "\n\n" +
            (diffString && diffString.includes("- Expect")
              ? `Difference:\n\n${diffString}`
              : `Expected: ${this.utils.printExpected(expected)}\n` +
                `Received: ${this.utils.printReceived(actual)}`)
          );
        };

    return { actual: received, message, pass };
  },
  async toIncludeCss(received: string, argument: string) {
    const options = {
      comment: "stripped(received).includes(stripped(argument))",
      isNot: this.isNot,
      promise: this.promise,
    };

    const actual = await format(received);
    const expected = await format(argument);

    const pass = actual.includes(expected);

    const message = pass
      ? () => {
          return (
            this.utils.matcherHint(
              "toIncludeCss",
              undefined,
              undefined,
              options
            ) +
            "\n\n" +
            `Expected: not ${this.utils.printExpected(format(received))}\n` +
            `Received: ${this.utils.printReceived(format(argument))}`
          );
        }
      : () => {
          const diffString = diff(expected, actual, {
            expand: this.expand!,
          });

          return (
            this.utils.matcherHint(
              "toIncludeCss",
              undefined,
              undefined,
              options
            ) +
            "\n\n" +
            (diffString && diffString.includes("- Expect")
              ? `Difference:\n\n${diffString}`
              : `Expected: ${this.utils.printExpected(expected)}\n` +
                `Received: ${this.utils.printReceived(actual)}`)
          );
        };

    return { actual: received, message, pass };
  },
});

expect.extend({
  toMatchFormattedCss(received: string, argument: string) {
    const options = {
      comment: "stripped(received) === stripped(argument)",
      isNot: this.isNot,
      promise: this.promise,
    };

    let formattedReceived = format(received);
    let formattedArgument = format(argument);

    const pass = formattedReceived === formattedArgument;

    const message = pass
      ? () => {
          return (
            this.utils.matcherHint(
              "toMatchCss",
              undefined,
              undefined,
              options
            ) +
            "\n\n" +
            `Expected: not ${this.utils.printExpected(formattedReceived)}\n` +
            `Received: ${this.utils.printReceived(formattedArgument)}`
          );
        }
      : () => {
          const actual = formattedReceived;
          const expected = formattedArgument;

          const diffString = diff(expected, actual, {
            expand: this.expand!,
          });

          return (
            this.utils.matcherHint(
              "toMatchCss",
              undefined,
              undefined,
              options
            ) +
            "\n\n" +
            (diffString && diffString.includes("- Expect")
              ? `Difference:\n\n${diffString}`
              : `Expected: ${this.utils.printExpected(expected)}\n` +
                `Received: ${this.utils.printReceived(actual)}`)
          );
        };

    return { actual: received, message, pass };
  },
});

interface CustomMatchers<R = unknown> {
  toMatchCss(expected: string): R;
  toIncludeCss(expected: string): Promise<R>;
  toMatchFormattedCss(expected: string): R;
}

declare module "vitest" {
  interface Matchers<T = any> extends CustomMatchers<T> {}
}
