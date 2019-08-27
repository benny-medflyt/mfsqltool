import "source-map-support/register"; // tslint:disable-line:no-import-side-effect

import { assertNever } from "assert-never";
import * as commander from "commander";
import { DbConnector } from "./DbConnector";
import { ErrorDiagnostic } from "./ErrorDiagnostic";
import { codeFrameFormatter } from "./formatters/codeFrameFormatter";
import { vscodeFormatter } from "./formatters/vscodeFormatter";
import { PostgresServer } from "./launch_postgres";
import { parsePostgreSqlError } from "./pg_extra";
import { isTestDatabaseCluster } from "./pg_test_db";
import { SqlCheckerEngine, typeScriptSingleRunCheck, TypeScriptWatcher } from "./sqlchecker_engine";

interface PostgresConnection {
    readonly url: string;
    readonly databaseName: string | undefined;
}

enum Format {
    CODE_FRAME,
    VSCODE
}

interface Options {
    readonly watchMode: boolean;
    readonly projectDir: string;
    readonly migrationsDir: string;
    readonly uniqueTableColumnTypesFile: string | null;
    readonly postgresConnection: PostgresConnection | null;
    readonly format: Format;
}

export class ParseError extends Error {
    constructor(public readonly message: string) {
        super(message);
    }
}

function parseFormat(value: string): Format {
    switch (value) {
        case "code-frame":
            return Format.CODE_FRAME;
        case "vscode":
            return Format.VSCODE;
        default:
            throw new ParseError(`invalid format: "${value}"`);
    }
}

function parseOptions(): Options {
    const program = new commander.Command();
    program.version("0.0.1");

    program
        .option("-w, --watch", "watch mode")
        .option("-p, --project <dir>", "Project directory that should be checked")
        .option("-m, --migrations <dir>", "Migrations directory that should be used")
        .option("-c, --unique-cols <file>", "Unique table column types file")
        .option("-u, --postgres-url <url>", "PostgreSQL connection string")
        .option("-d, --db-name <name>", "Name of database to use")
        .option("-t, --format <format>", "code-frame", parseFormat, Format.CODE_FRAME);

    try {
        program.parse(process.argv);
    } catch (err) {
        if (err instanceof ParseError) {
            console.error("error: " + err.message);
            process.exit(1);
        } else {
            throw err;
        }
    }

    if (process.argv.slice(2).length === 0) {
        program.outputHelp();
        process.exit(1);
    }

    function required(arg: string, argFlag: string) {
        if (!program[arg]) {
            console.error(`error: missing required argument: ${argFlag}`);
            process.exit(1);
        }
    }

    required("project", "--project");
    required("migrations", "--migrations");

    if (program.dbName && !program.postgresUrl) {
        console.error(`error: --db-name argument can only be used together with --postgres-url`);
        process.exit(1);
    }

    let postgres: PostgresConnection | null;
    if (program.postgresUrl) {
        postgres = {
            url: program.postgresUrl,
            databaseName: program.dbName ? program.dbName : undefined
        };
    } else {
        postgres = null;
    }

    const options: Options = {
        watchMode: program.watch === true,
        projectDir: program.project,
        migrationsDir: program.migrations,
        uniqueTableColumnTypesFile: program.uniqueCols ? program.uniqueCols : null,
        postgresConnection: postgres,
        format: program.format
    };
    return options;
}

function formatFunction(format: Format): (errorDiagnostic: ErrorDiagnostic) => string {
    switch (format) {
        case Format.CODE_FRAME:
            return codeFrameFormatter;
        case Format.VSCODE:
            return vscodeFormatter;
        default:
            return assertNever(format);
    }
}

async function main(): Promise<void> {
    const options = parseOptions();

    if (options.postgresConnection !== null && !isTestDatabaseCluster(options.postgresConnection.url)) {
        console.error("Database Cluster url is not a local connection or is invalid:\n" + options.postgresConnection.url);
        process.exit(1);
    }

    let pgServer: PostgresServer | null = null;

    let url: string;
    let dbName: string | undefined;
    if (options.postgresConnection !== null) {
        url = options.postgresConnection.url;
        dbName = options.postgresConnection.databaseName;
    } else {
        pgServer = await PostgresServer.start("10.10");
        url = pgServer.url;
        dbName = undefined;
    }
    try {

        process.on("SIGINT", async () => {
            if (pgServer !== null) {
                await pgServer.close();
                pgServer = null;
            }
            process.exit();
        });

        let dbConnector: DbConnector;
        try {
            dbConnector = await DbConnector.Connect(options.migrationsDir, options.uniqueTableColumnTypesFile, url, dbName);
        } catch (err) {
            const perr = parsePostgreSqlError(err);
            if (perr !== null) {
                console.error("Error connecting to database cluster:");
                console.error(perr.message);
                console.error("code: " + perr.code);
                if (perr.detail !== null && perr.detail !== perr.message) {
                    console.error("detail: " + perr.detail);
                }
                if (perr.hint !== null) {
                    console.error("hint: " + perr.hint);
                }
            } else if (err.code) {
                console.error("Error connecting to database cluster:");
                console.error(err.message);
            } else {
                throw err;
            }
            return process.exit(1);
        }
        try {
            const formatter = formatFunction(options.format);
            const e = new SqlCheckerEngine(options.uniqueTableColumnTypesFile, dbConnector);
            if (options.watchMode) {
                const w = new TypeScriptWatcher(e, formatter);
                w.run(options.projectDir);
                await blockForever();
            } else {
                const success = await typeScriptSingleRunCheck(options.projectDir, e, formatter);
                if (!success) {
                    process.exitCode = 1;
                }
            }
        } finally {
            await dbConnector.close();
        }
    } finally {
        if (pgServer !== null) {
            await pgServer.close();
        }
    }
}

function blockForever(): Promise<void> {
    return new Promise<void>(() => { /* Block Forever */ });
}

main();

// import * as ts from "typescript";
// import * as fs from "fs";

// interface DocEntry {
//   name?: string;
//   fileName?: string;
//   documentation?: string;
//   type?: string;
//   constructors?: DocEntry[];
//   parameters?: DocEntry[];
//   returnType?: string;
// }

// /** Generate documentation for all classes in a set of .ts files */
// function generateDocumentation(
//   fileNames: string[],
//   options: ts.CompilerOptions
// ): void {
//   // Build a program using the set of root file names in fileNames
//   let program = ts.createProgram(fileNames, options);

//   // Get the checker, we will use it to find more about classes
//   let checker = program.getTypeChecker();

//   let output: DocEntry[] = [];

//   // Visit every sourceFile in the program
//   for (const sourceFile of program.getSourceFiles()) {
//     if (!sourceFile.isDeclarationFile) {
//       // Walk the tree to search for classes
//       ts.forEachChild(sourceFile, visit);
//     }
//   }

//   // print out the doc
//   fs.writeFileSync("classes.json", JSON.stringify(output, undefined, 4));

//   return;

//   /** visit nodes finding exported classes */
//   function visit(node: ts.Node) {
//     // Only consider exported nodes
//     if (!isNodeExported(node)) {
//       return;
//     }

//     if (ts.isClassDeclaration(node) && node.name) {
//       // This is a top level class, get its symbol
//       let symbol = checker.getSymbolAtLocation(node.name);
//       if (symbol) {
//         output.push(serializeClass(symbol));
//       }
//       // No need to walk any further, class expressions/inner declarations
//       // cannot be exported
//     } else if (ts.isModuleDeclaration(node)) {
//       // This is a namespace, visit its children
//       ts.forEachChild(node, visit);
//     }
//   }

//   /** Serialize a symbol into a json object */
//   function serializeSymbol(symbol: ts.Symbol): DocEntry {
//     return {
//       name: symbol.getName(),
//       type: checker.typeToString(
//         checker.getTypeOfSymbolAtLocation(symbol, symbol.valueDeclaration!)
//       )
//     };
//   }

//   /** Serialize a class symbol information */
//   function serializeClass(symbol: ts.Symbol) {
//     let details = serializeSymbol(symbol);

//     // Get the construct signatures
//     let constructorType = checker.getTypeOfSymbolAtLocation(
//       symbol,
//       symbol.valueDeclaration!
//     );
//     details.constructors = constructorType
//       .getConstructSignatures()
//       .map(serializeSignature);
//     return details;
//   }

//   /** Serialize a signature (call or construct) */
//   function serializeSignature(signature: ts.Signature) {
//     return {
//       parameters: signature.parameters.map(serializeSymbol),
//       returnType: checker.typeToString(signature.getReturnType())
//     };
//   }

//   /** True if this is visible outside this file, false otherwise */
//   function isNodeExported(node: ts.Node): boolean {
//     return (
//       (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export) !== 0 ||
//       (!!node.parent && node.parent.kind === ts.SyntaxKind.SourceFile)
//     );
//   }
// }

// generateDocumentation(process.argv.slice(2), {
//   target: ts.ScriptTarget.ES5,
//   module: ts.ModuleKind.CommonJS
// });
