/**
 * Small local module declaration for `mailparser`'s `simpleParser` - the
 * package ships no types of its own and no `@types/mailparser` is
 * installed. Covers only the `ParsedMail` fields this codebase actually
 * reads (see `ai-content.service.ts` and `eml-dataset.client.ts`), not the
 * library's full surface.
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
  }

  export function simpleParser(
    source: string | Buffer
  ): Promise<ParsedMail>;
}
