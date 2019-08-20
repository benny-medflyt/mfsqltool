import { assertNever } from "assert-never";
import chalk from "chalk";
import { Bar, Presets } from "cli-progress";
import * as fs from "fs";
import * as path from "path";
import * as pg from "pg";
import { Either } from "./either";
import { ErrorDiagnostic, postgresqlErrorDiagnostic, SrcSpan, toSrcSpan } from "./ErrorDiagnostic";
import { closePg, connectPg, dropAllTables, parsePostgreSqlError, pgDescribeQuery, pgMonkeyPatchClient, PostgreSqlError } from "./pg_extra";
import { calcDbMigrationsHash, connReplaceDbName, createBlankDatabase, dropDatabase, isMigrationFile, readdirAsync, testDatabaseName } from "./pg_test_db";
import { ColNullability, ResolvedQuery, SqlType } from "./queries";
import { resolveFromSourceMap } from "./source_maps";
import { QualifiedSqlViewName, SqlCreateView } from "./views";

export interface Manifest {
    viewLibrary: SqlCreateView[];
    queries: Either<ErrorDiagnostic[], ResolvedQuery>[];
}

export type QueryCheckResult = QueryCheckResult.InvalidText;

namespace QueryCheckResult {
    export interface InvalidText {
        type: "InvalidText";
        error: PostgreSqlError;
    }

    export interface DuplicateResultColumnNames {
        type: "DuplicateResultColumnNames";
        duplicateResultColumnNames: string[];
    }
}

export class DbConnector {
    private constructor(migrationsDir: string, client: pg.Client) {
        this.migrationsDir = migrationsDir;
        this.client = client;
        pgMonkeyPatchClient(this.client);
    }

    static async Connect(migrationsDir: string, adminUrl: string, name?: string): Promise<DbConnector> {
        const client = await newConnect(adminUrl, name);
        return new DbConnector(migrationsDir, client);
    }

    private migrationsDir: string;
    private client: pg.Client;

    private viewNames: [string, ViewAnswer][] = [];

    private dbMigrationsHash: string = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";

    private tableColsLibrary = new TableColsLibrary();

    private queryCache = new QueryMap<QueryAnswer>();

    async validateManifest(manifest: Manifest): Promise<ErrorDiagnostic[]> {
        const hash = await calcDbMigrationsHash(this.migrationsDir);
        if (this.dbMigrationsHash !== hash) {
            this.dbMigrationsHash = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
            this.queryCache.clear();
            for (let i = this.viewNames.length - 1; i >= 0; --i) {
                const viewName = this.viewNames[i];
                await dropView(this.client, viewName[0]);
            }
            this.viewNames = [];

            await dropAllTables(this.client);

            const allFiles = await readdirAsync(this.migrationsDir);
            const matchingFiles = allFiles.filter(isMigrationFile).sort();
            for (const matchingFile of matchingFiles) {
                console.log("matchingFile", matchingFile);
                const text = await readFileAsync(path.join(this.migrationsDir, matchingFile));
                try {
                    await this.client.query(text);
                } catch (err) {
                    const perr = parsePostgreSqlError(err);
                    if (perr === null) {
                        throw err;
                    } else {
                        const errorDiagnostic = postgresqlErrorDiagnostic(path.join(this.migrationsDir, matchingFile), text, perr, toSrcSpan(text, perr.position), "Error in migration file");
                        return [errorDiagnostic];
                    }
                }
            }

            this.dbMigrationsHash = hash;
        }

        console.log(new Date(), hash);

        let queryErrors: ErrorDiagnostic[] = [];

        this.viewNames = await updateViews(this.client, this.viewNames, manifest.viewLibrary);

        await this.tableColsLibrary.refresh(this.client);

        for (const [viewName, viewAnswer] of this.viewNames) {
            const createView = manifest.viewLibrary.find(x => x.viewName === viewName);
            if (createView === undefined) {
                throw new Error("The Impossible Happened");
            }
            queryErrors = queryErrors.concat(viewAnswerToErrorDiagnostics(createView, viewAnswer));
        }


        const newQueryCache = new QueryMap<QueryAnswer>();

        const queriesProgressBar = new Bar({
            clearOnComplete: true,
            etaBuffer: 50
        }, Presets.legacy);
        queriesProgressBar.start(manifest.queries.length, 0);
        try {
            let i = 0;
            for (const query of manifest.queries) {
                switch (query.type) {
                    case "Left":
                        break;
                    case "Right":
                        const cachedResult = this.queryCache.get(query.value.text, query.value.colTypes);
                        if (cachedResult !== undefined) {
                            queryErrors = queryErrors.concat(queryAnswerToErrorDiagnostics(query.value, cachedResult));
                            newQueryCache.set(query.value.text, query.value.colTypes, cachedResult);
                        } else {
                            const result = await processQuery(this.client, this.tableColsLibrary, query.value);
                            newQueryCache.set(query.value.text, query.value.colTypes, result);
                            queryErrors = queryErrors.concat(queryAnswerToErrorDiagnostics(query.value, result));
                        }
                        break;
                    default:
                        assertNever(query);
                }
                queriesProgressBar.update(++i);
            }
        } finally {
            queriesProgressBar.stop();
        }

        this.queryCache = newQueryCache;

        let xx: ErrorDiagnostic[] = [];
        for (const query of manifest.queries) {
            switch (query.type) {
                case "Left":
                    xx = xx.concat(query.value);
                    break;
                case "Right":
                    xx = xx.concat(query.value.errors);
                    break;
                default:
                    assertNever(query);
            }
        }
        console.log("xx", xx);
        return xx.concat(queryErrors);

        // console.log(new Date());
        // for (let i = 0; i < 1; ++i) {
        //     for (const query of manifest.queries) {
        //         console.log(query);
        //         let fields: pg.FieldDef[] | null;
        //         try {
        //             fields = await pgDescribeQuery(this.client, query);
        //         } catch (err) {
        //             if (getPostgreSqlErrorCode(err) === null) {
        //                 throw err;
        //             } else {
        //                 // Problem with the query
        //                 // TODO ...
        //                 console.log(err);
        //                 return null as any;
        //             }
        //         }
        //         console.log(fields)
        //     }
        // }
        // console.log(new Date());
    }

    resetViews(): Promise<void> {
        throw new Error("TODO");
    }
}

async function dropView(client: pg.Client, viewName: string): Promise<void> {
    await client.query(`DROP VIEW IF EXISTS ${viewName}`);
}

/**
 * @returns Array with the same length as `newViews`, with a matching element
 * for each view in `newViews`
 */
async function updateViews(client: pg.Client, oldViews: [string, ViewAnswer][], newViews: SqlCreateView[]): Promise<[string, ViewAnswer][]> {
    const newViewNames = new Set<string>();
    newViews.forEach(v => newViewNames.add(v.viewName));

    for (let i = oldViews.length - 1; i >= 0; --i) {
        const viewName = oldViews[i];
        if (!newViewNames.has(viewName[0])) {
            console.log("Dropping view", viewName[0]);
            await dropView(client, viewName[0]);
        }
    }

    const oldViewAnswers = new Map<string, ViewAnswer>();
    oldViews.forEach(([viewName, viewAnswer]) => oldViewAnswers.set(viewName, viewAnswer));

    const result: [string, ViewAnswer][] = [];

    for (const view of newViews) {
        const oldAnswer = oldViewAnswers.get(view.viewName);
        if (oldAnswer !== undefined) {
            result.push([view.viewName, oldAnswer]);
        } else {
            const answer = await processCreateView(client, view);
            result.push([view.viewName, answer]);
        }
    }

    return result;
}

async function processCreateView(client: pg.Client, view: SqlCreateView): Promise<ViewAnswer> {
    try {
        console.log("Executing view", view.viewName);
        await client.query(`CREATE OR REPLACE VIEW ${view.viewName} AS ${view.createQuery}`);
    } catch (err) {
        const perr = parsePostgreSqlError(err);
        if (perr === null) {
            throw err;
        } else {
            if (perr.position !== null) {
                // A bit hacky but does the trick:
                perr.position -= `CREATE OR REPLACE VIEW ${view.viewName} AS `.length;
            }
            return {
                type: "CreateError",
                viewName: QualifiedSqlViewName.viewName(view.qualifiedViewname),
                perr: perr
            };
        }
    }

    return {
        type: "NoErrors"
    };
}

type ViewAnswer =
    ViewAnswer.NoErrors |
    ViewAnswer.CreateError;

namespace ViewAnswer {
    export interface NoErrors {
        type: "NoErrors";
    }

    export interface CreateError {
        type: "CreateError";
        viewName: string;
        perr: PostgreSqlError;
    }
}

function viewAnswerToErrorDiagnostics(createView: SqlCreateView, viewAnswer: ViewAnswer): ErrorDiagnostic[] {
    switch (viewAnswer.type) {
        case "NoErrors":
            return [];
        case "CreateError":
            const message = "Error in view \"" + chalk.bold(viewAnswer.viewName) + "\"";
            if (viewAnswer.perr.position !== null) {
                const p = resolveFromSourceMap(viewAnswer.perr.position, createView.sourceMap);
                return [postgresqlErrorDiagnostic(createView.fileName, createView.fileContents, viewAnswer.perr, toSrcSpan(createView.fileContents, p), message)];
            } else {
                return [postgresqlErrorDiagnostic(createView.fileName, createView.fileContents, viewAnswer.perr, querySourceStart(createView.fileContents, createView.sourceMap), message)];
            }
        default:
            return assertNever(viewAnswer);
    }
}

/**
 * Type safe "Map"-like from queries to some T
 */
class QueryMap<T> {
    set(text: string, colTypes: Map<string, [ColNullability, SqlType]> | null, value: T): void {
        this.internalMap.set(QueryMap.toKey(text, colTypes), value);
    }

    get(text: string, colTypes: Map<string, [ColNullability, SqlType]> | null): T | undefined {
        return this.internalMap.get(QueryMap.toKey(text, colTypes));
    }

    clear(): void {
        this.internalMap = new Map<string, T>();
    }

    private static toKey(text: string, colTypes: Map<string, [ColNullability, SqlType]> | null): string {
        // TODO Will this really always give a properly unique key?
        return text + (colTypes === null ? "" : stringifyColTypes(colTypes));
    }

    private internalMap = new Map<string, T>();
}

type QueryAnswer =
    QueryAnswer.NoErrors |
    QueryAnswer.DescribeError |
    QueryAnswer.DuplicateColNamesError |
    QueryAnswer.WrongColumnTypes;

namespace QueryAnswer {
    export interface NoErrors {
        type: "NoErrors";
    }

    export interface DescribeError {
        type: "DescribeError";
        perr: PostgreSqlError;
    }

    export interface DuplicateColNamesError {
        type: "DuplicateColNamesError";
        duplicateResultColumns: string[];
    }

    export interface WrongColumnTypes {
        type: "WrongColumnTypes";
        renderedColTypes: string;
    }
}

function querySourceStart(fileContents: string, sourceMap: [number, number][]): SrcSpan {
    return toSrcSpan(fileContents, fileContents.slice(sourceMap[0][1] + 1).search(/\S/) + sourceMap[0][1] + 2);
}

function queryAnswerToErrorDiagnostics(query: ResolvedQuery, queryAnswer: QueryAnswer): ErrorDiagnostic[] {
    switch (queryAnswer.type) {
        case "NoErrors":
            return [];
        case "DescribeError":
            if (queryAnswer.perr.position !== null) {
                const p = resolveFromSourceMap(queryAnswer.perr.position, query.sourceMap);
                return [postgresqlErrorDiagnostic(query.fileName, query.fileContents, queryAnswer.perr, toSrcSpan(query.fileContents, p), null)];
            } else {
                return [postgresqlErrorDiagnostic(query.fileName, query.fileContents, queryAnswer.perr, querySourceStart(query.fileContents, query.sourceMap), null)];
            }
        case "DuplicateColNamesError":
            return [{
                fileName: query.fileName,
                fileContents: query.fileContents,
                span: querySourceStart(query.fileContents, query.sourceMap),
                messages: [`Query return row contains duplicate column names:\n${JSON.stringify(queryAnswer.duplicateResultColumns, null, 2)}`],
                epilogue: chalk.bold("hint") + ": Specify a different name for the column using the Sql \"AS\" keyword"
            }];
        case "WrongColumnTypes":
            return [{
                fileName: query.fileName,
                fileContents: query.fileContents,
                span: query.colTypeSpan,
                messages: ["Wrong Column Types"],
                epilogue: chalk.bold("Fix it to:") + "\n" + queryAnswer.renderedColTypes
            }];
        default:
            return assertNever(queryAnswer);
    }
}

async function processQuery(client: pg.Client, tableColsLibrary: TableColsLibrary, query: ResolvedQuery): Promise<QueryAnswer> {
    let fields: pg.FieldDef[] | null;
    try {
        fields = await pgDescribeQuery(client, query.text);
    } catch (err) {
        const perr = parsePostgreSqlError(err);
        if (perr === null) {
            throw err;
        } else {
            return {
                type: "DescribeError",
                perr: perr
            };
        }
    }

    const duplicateResultColumns: string[] = [];
    if (fields === null) {
        if (query.colTypes !== null && query.colTypes.size !== 0) {
            return {
                type: "WrongColumnTypes",
                renderedColTypes: "{} (Or no type argument at all)"
            };
        }
    } else {
        for (let i = 0; i < fields.length; ++i) {
            const field = fields[i];
            if (fields.slice(i + 1).findIndex(f => f.name === field.name) >= 0 && duplicateResultColumns.indexOf(field.name) < 0) {
                duplicateResultColumns.push(field.name);
            }
        }

        if (duplicateResultColumns.length > 0) {
            return {
                type: "DuplicateColNamesError",
                duplicateResultColumns: duplicateResultColumns
            };
        }

        const sqlFields = resolveFieldDefs(tableColsLibrary, fields);
        if (query.colTypes !== null && stringifyColTypes(query.colTypes) !== stringifyColTypes(sqlFields)) {
            return {
                type: "WrongColumnTypes",
                renderedColTypes: renderColTypesType(sqlFields)
            };
        }
    }

    return {
        type: "NoErrors"
    };
}

function psqlOidSqlType(oid: number): SqlType {
    switch (oid) {
        case 20:
        case 23:
            return SqlType.wrap("int");
        case 25:
            return SqlType.wrap("text");
        case 13:
            return SqlType.wrap("boolean");
        case 1082:
            return SqlType.wrap("date");
        default:
            throw new Error(`TODO psqlOidSqlType oid ${oid}`);
    }
}

class TableColsLibrary {
    public async refresh(client: pg.Client): Promise<void> {
        this.lookupTable = new Map<string, boolean>();

        const queryResult = await client.query(
            `
            SELECT
                a.attrelid,
                a.attnum,
                a.attnotnull
            FROM
            pg_catalog.pg_attribute a
            WHERE
            a.attnum > 0;
            `);

        for (const row of queryResult.rows) {
            const attrelid: number = row["attrelid"];
            const attnum: number = row["attnum"];
            const attnotnull: boolean = row["attnotnull"];

            this.lookupTable.set(`${attrelid}-${attnum}`, attnotnull);
        }
    }

    public isNotNull(tableID: number, columnID: number): boolean {
        const notNull = this.lookupTable.get(`${tableID}-${columnID}`);
        if (notNull === undefined) {
            throw new Error(`Couldn't find column in table ${tableID}-${columnID}`);
        }
        return notNull;
    }

    private lookupTable = new Map<string, boolean>();
}

export function resolveFieldDefs(tableColsLibrary: TableColsLibrary, fields: pg.FieldDef[]): Map<string, [ColNullability, SqlType]> {
    const result = new Map<string, [ColNullability, SqlType]>();

    for (const field of fields) {
        const sqlType = psqlOidSqlType(field.dataTypeID);
        let colNullability: ColNullability = ColNullability.OPT;
        if (field.tableID > 0) {
            const notNull = tableColsLibrary.isNotNull(field.tableID, field.columnID);
            if (notNull) {
                colNullability = ColNullability.REQ;
            }
        }
        result.set(field.name, [colNullability, sqlType]);
    }

    return result;
}

function sqlTypeToTypeScriptType(sqlType: SqlType): string {
    switch (SqlType.unwrap(sqlType)) {
        case "int":
            return "number";
        case "text":
            return "string";
        case "boolean":
            return "boolean";
        case "date":
            return "LocalDate";
        default:
            throw new Error(`TODO sqlTypeToTypeScriptType ${sqlType}`);
    }
}

function colNullabilityStr(colNullability: ColNullability): string {
    switch (colNullability) {
        case ColNullability.REQ:
            return "Req";
        case ColNullability.OPT:
            return "Opt";
        default:
            return assertNever(colNullability);
    }
}

function renderIdentifier(ident: string): string {
    // TODO wrap key in double quotes if not a valid JavaScript identifier

    return ident;
}

function renderColTypesType(colTypes: Map<string, [ColNullability, SqlType]>): string {
    if (colTypes.size === 0) {
        return "{}";
    }

    let result = "{\n";

    colTypes.forEach((value, key) => {

        result += `  ${renderIdentifier(key)}: ${colNullabilityStr(value[0])}<${sqlTypeToTypeScriptType(value[1])}>,\n`;
    });

    // Remove trailing comma
    result = result.substr(0, result.length - 2);

    result += "\n}";
    return result;
}

/**
 * Will return a canonical representation, that can be used for comparisons
 */
function stringifyColTypes(colTypes: Map<string, [ColNullability, SqlType]>): string {
    const keys = [...colTypes.keys()];
    keys.sort();
    let result = "";
    for (const key of keys) {
        const value = colTypes.get(key);
        if (value === undefined) {
            throw new Error("The Impossible Happened");
        }
        result += `${JSON.stringify(key)}:${value[0]} ${value[1]}\n`;
    }
    return result;
}

async function newConnect(adminUrl: string, name?: string): Promise<pg.Client> {
    const newDbName = name !== undefined
        ? name
        : await testDatabaseName();

    const adminConn1 = await connectPg(adminUrl);
    try {
        if (name !== undefined) {
            await dropDatabase(adminConn1, name);
        }

        await createBlankDatabase(adminConn1, newDbName);
    } finally {
        await closePg(adminConn1);
    }

    const client = await connectPg(connReplaceDbName(adminUrl, newDbName));
    return client;
}

function readFileAsync(fileName: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        fs.readFile(fileName, { encoding: "utf-8" }, (err, data) => {
            if (<boolean><any>err) {
                reject(err);
            } else {
                resolve(data);
            }
        });
    });
}
