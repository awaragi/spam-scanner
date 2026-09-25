/**
 * Small local module declaration for `mailparser`'s `simpleParser` - the
 * package ships no types of its own and no `@types/mailparser` is
 * installed. Covers only the `ParsedMail` fields this codebase actually
 * reads (see `domain/ai/ai-content.ts`), not the library's full surface.
 * Ported from `terminal/src/lib/types/mailparser.d.ts`.
 */
declare module 'mailparser' {
  export interface AddressObject {
    value: Array<{ address?: string; name?: string }>;
  }

  export interface ParsedMail {
    text?: string;
    html?: string | false;
    from?: AddressObject;
    to?: AddressObject;
    subject?: string;
    date?: Date;
    // Value type varies by header name (string, string[], Date,
    // AddressObject, ...) - callers narrow per header, same as mailparser's
    // own (loosely-typed) runtime behavior.
    headers: Map<string, unknown>;
  }

  export interface SimpleParserOptions {
    skipHtmlToText?: boolean;
    skipTextToHtml?: boolean;
    skipImageLinks?: boolean;
  }

  export function simpleParser(
    source: string | Buffer,
    options?: SimpleParserOptions
  ): Promise<ParsedMail>;
}
