import * as commander from "commander";
import { DbConnector } from "./DbConnector";
import { parsePostgreSqlError } from "./pg_extra";
import { isTestDatabaseCluster } from "./pg_test_db";
import { SqlCheckerEngine, TypeScriptWatcher } from "./sqlchecker_engine";

interface PostgresConnection {
    readonly url: string;
    readonly databaseName: string | undefined;
}

interface Options {
    readonly watchMode: boolean;
    readonly projectDir: string;
    readonly migrationsDir: string;
    readonly postgresConnection: PostgresConnection;
}

function parseOptions(): Options {
    const program = new commander.Command();
    program.version("0.0.1");

    program
        .option("-w, --watch", "watch mode")
        .option("-p, --project <dir>", "Project directory that should be checked")
        .option("-m, --migrations <dir>", "Migrations directory that should be used")
        .option("-u, --postgres-url <url>", "PostgreSQL connection string")
        .option("-d, --db-name <name>", "Name of database to use");

    program.parse(process.argv);

    if (!process.argv.slice(2).length) {
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
    required("postgresUrl", "--postgres-url");

    const options: Options = {
        watchMode: program.watch === true,
        projectDir: program.project,
        migrationsDir: program.migrations,
        postgresConnection: {
            url: program.postgresUrl,
            databaseName: program.dbName ? program.dbName : undefined
        }
    };
    return options;
}

async function main(): Promise<void> {
    const options = parseOptions();

    if (!isTestDatabaseCluster(options.postgresConnection.url)) {
        console.error("Database Cluster url is not a local connection or is invalid:\n" + options.postgresConnection.url);
        // process.exit(1);
    }

    let dbConnector: DbConnector;
    try {
        dbConnector = await DbConnector.Connect(options.migrationsDir, options.postgresConnection.url, options.postgresConnection.databaseName);
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

    const e = new SqlCheckerEngine(dbConnector);
    const w = new TypeScriptWatcher(e);
    w.run(options.projectDir);
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
