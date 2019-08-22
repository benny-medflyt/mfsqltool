import * as fs from "fs";
import * as pg from "pg";
import * as stackTrace from "stack-trace";
import { assertNever } from "assert-never";
import { calcViewName } from "./view_names";

export type ColumnParser<T> = (value: any) => T;

export class Connection {
    /**
     * Used only to statically identify this type
     */
    protected readonly MfConnectionTypeTag: undefined;

    constructor(client: pg.Client, columnParsers: Map<number, ColumnParser<any>>) {
        this.client = client;
        this.columnParsers = columnParsers;
    }

    readonly client: pg.Client;

    async query<Row extends object = any>(query: SqlQueryExpr): Promise<ResultRow<Row>[]> {
        const queryResult = await this.client.query(query.text, query.values);
        for (const row of queryResult.rows) {
            for (const field of queryResult.fields) {
                const parser = this.columnParsers.get(field.dataTypeID);
                const fieldName = field.name;
                row[fieldName] = new RealVal(parser !== undefined ? parser(row[fieldName]) : row[fieldName], fieldName, row);
            }
        }

        return queryResult.rows;
    }

    async queryOne<Row extends object = any>(query: SqlQueryExpr): Promise<ResultRow<Row>> {
        const rows = await this.query(query);
        if (rows.length !== 1) {
            throw new Error(`Expected query to return 1 row. Got ${rows.length} rows`);
        }
        return rows[0];
    }

    async queryOneOrNone<Row extends object = any>(query: SqlQueryExpr): Promise<ResultRow<Row> | null> {
        const rows = await this.query(query);
        if (rows.length === 0) {
            return null;
        } else if (rows.length === 1) {
            return rows[0];
        } else {
            throw new Error(`Expected query to return 0 or 1 rows. Got ${rows.length} rows`);
        }
    }

    private readonly columnParsers: Map<number, ColumnParser<any>>;
}

class SqlQueryExpr {
    constructor(text: string, values: any[]) {
        this.text = text;
        this.values = values;
    }

    public readonly text: string;
    public readonly values: any[];

    protected dummy: SqlQueryExpr[];
}

type SqlQueryPlaceHolder = SqlView | number | string | boolean | null;

export function sql(literals: TemplateStringsArray, ...placeholders: SqlQueryPlaceHolder[]): SqlQueryExpr {
    let text = "";
    let values: any[] = [];

    text += literals[0];
    for (let i = 0; i < placeholders.length; ++i) {
        const placeholder = placeholders[i];
        if (typeof placeholder === "number" || typeof placeholder === "string" || typeof placeholder === "boolean" || placeholder === null) {
            values.push(placeholder);
            text += `($${values.length})`;
        } else {
            switch (placeholder.type) {
                case "SqlView":
                    if (!placeholder.resolved) {
                        throw new Error(`View "${placeholder.viewName}" has not been created. Views are only allowed to be defined at module-level scope`);
                    }
                    text += `"${placeholder.viewName}"`;
                    break;
                default:
                    assertNever(placeholder.type);
            }
        }
        text += literals[i + 1];
    }

    return new SqlQueryExpr(text, values);
}

type ResultRow<T> = {
    [P in keyof T]: (
        T[P] extends Req<any> ? (
            T[P]
        ) : (
            T[P] extends Opt<any> ? (
                T[P]
            ) : (
                // TODO If TypeScript ever adds the "invalid" type then use it
                // here instead of "never"
                // <https://github.com/microsoft/TypeScript/issues/23689>
                never
            )
        )
    );
}

export abstract class Req<T> {
    /**
     * Retrieve the value of the column
     */
    abstract val(): T;

    /**
     * Retrieve the value of the column when it may be null. Use this when the
     * column is the result of a LEFT JOIN
     */
    abstract forceNullable(): T | null;

    protected dummy: Req<T>[];
}

export abstract class Opt<T> {
    /**
     * Retreive the value of the column
     */
    abstract valOpt(): T | null;

    /**
     * Retreive the value of the column when you are sure that it cannot be
     * null. This is appropriate to use on columns that are a result of some
     * computation that you know cannot return a null result.
     */
    abstract forceNotNull(): T;

    protected dummy: Opt<T>[];
}

/**
 * A bizarre hybrid implementation of both `Req` and `Opt`
 */
class RealVal {
    // Micro-optimization: short variable names to save memory (we might have
    // thousands of these objects)
    constructor(private readonly v: any,
        private readonly c: string,
        private readonly r: any) { }

    /**
     * Implementation of Req<T>.val
     */
    val(): any {
        if (this.v === null) {
            throw new Error(`Column "${this.c}" is NULL!\nTwo fixes:\n1. Use "forceNullable" (instead of "val")\n2. Modify your SQL query to return an "Opt<T>" column\nFull row:\n${stringifyRealValRow(this.r)}`);
        }
        return this.v;
    }

    /**
     * Implementation of Req<T>.forceNullable
     */
    forceNullable(): any | null {
        return this.v;
    }

    /**
     * Implementation of Opt<T>.valOpt
     */
    valOpt(): any | null {
        return this.v;
    }

    /**
     * Implementation of Opt<T>.forceNotNull
     */
    forceNotNull(): any {
        if (this.v === null) {
            throw new Error(`Column "${this.c}" is NULL!\nUse "valOpt" (instead of "forceNotNull")\nFull row:\n${stringifyRealValRow(this.r)}`);
        }
        return this.v;
    }
}

/**
 * Used for error messages
 */
function stringifyRealValRow(obj: any): string {
    const obj2: any = {};
    for (const key of Object.keys(obj)) {
        obj2[key] = obj[key].v;
    }
    return JSON.stringify(obj2);
}

interface SqlView {
    readonly type: "SqlView";
    readonly viewName: string;

    /**
     * Will be mutated to "true" in "initAllViews" (So that later during
     * run-time we can validate that "defineSqlView" was called properly (from
     * top-level, and not inside some function)
     */
    resolved: boolean;
}

interface SqlCreateView {
    readonly viewName: string;
    readonly createQuery: string;
}

const allSqlViewCreateStatements: SqlCreateView[] = [];

/**
 * Very hacky
 */
function peekAssignedVariableName(): string | null {
    const stackFrame = stackTrace.parse(new Error())[2];
    const file = fs.readFileSync(stackFrame.getFileName(), { encoding: "utf8" });
    const lines = file.split("\n");
    const line = lines[stackFrame.getLineNumber() - 1];

    const r = /(var|let|const)(\s+)(\w+)[\s=]/.exec(line);
    if (r === null) {
        return null;
    }
    return r[3];
}

export function defineSqlView(x: TemplateStringsArray, ...placeholders: SqlView[]): SqlView {
    const varName = peekAssignedVariableName();

    let query: string = x[0];
    for (let i = 0; i < placeholders.length; ++i) {
        query += "\"" + placeholders[i].viewName + "\"";
        query += x[i + 1];
    }

    const viewName = calcViewName(varName, query);

    console.log(varName);

    console.log(JSON.stringify(query), viewName);


    allSqlViewCreateStatements.push({
        viewName: viewName,
        createQuery:
            `
            CREATE OR REPLACE VIEW ${viewName}
            AS ${query}
            `
    });

    return {
        type: "SqlView",
        viewName: viewName,
        resolved: false
    };
}

export interface Connection { }

export async function dbExecute(_conn: Connection, _query: string): Promise<void> {
    throw new Error("TODO");
}

export async function dbQueryFindMissingViews(_conn: Connection, _viewNames: string[]): Promise<Set<string>> {
    throw new Error("TODO");
}

export async function initAllViews(conn: Connection) {
    // TODO Do this all in a single transaction (or maybe not?)

    const missingViews: Set<string> = await dbQueryFindMissingViews(conn, allSqlViewCreateStatements.map(view => view.viewName));

    for (const view of allSqlViewCreateStatements) {
        if (missingViews.has(view.viewName)) {
            await dbExecute(conn, view.createQuery);
        }
    }

    allSqlViewCreateStatements.splice(0, allSqlViewCreateStatements.length);
}
