import { defineSqlView, Opt, Req } from "../lib/sql_linter";

export const coolView = defineSqlView`SELECT 5`;

export function x(): void {
}

export interface XXX {
    blah: Opt<number>;
    asdf: Req<null>;
};
